import type { Client } from '@orpc/client'
import type { StandardLazyResponse } from '@standard-server/core'
import type { RouterUtilsOptions } from './router-utils'
import { createORPCClient } from '@orpc/client'
import { StandardLink } from '@orpc/client/standard'
import { CACHE_LINK_PLUGIN_CONTEXT_SYMBOL, CacheLinkPlugin } from '@orpc/experimental-cache'
import { encodeCacheTagHeader, promiseWithResolvers } from '@orpc/shared'
import { dehydrate, hydrate, InfiniteQueryObserver, MutationObserver, QueryClient, QueryObserver } from '@tanstack/query-core'
import { experimental_CacheRevalidationUtilsPlugin as CacheRevalidationUtilsPlugin } from './cache-revalidation-plugin'
import { createRouterUtils } from './router-utils'

type TestClient = {
  planet: {
    find: Client<object, { id: number }, string, Error>
    list: Client<object, { cursor: number }, string[], Error>
    update: Client<object, { id: number }, string, Error>
  }
  user: {
    me: Client<object, undefined, string, Error>
  }
}

interface Reply {
  output: unknown
  tags?: string[]
  revalidatedTags?: string[]
}

let version: number
const handlers = {
  'planet.find': vi.fn(async ({ id }: { id: number }): Promise<Reply> => ({
    output: `planet ${id} v${version}`,
    tags: [`planet:${id}`],
  })),
  'planet.list': vi.fn(async ({ cursor }: { cursor: number }): Promise<Reply> => ({
    output: [`page ${cursor} v${version}`],
    tags: [`page:${cursor}`],
  })),
  'planet.update': vi.fn(async ({ id }: { id: number }): Promise<Reply> => {
    version++
    return { output: `updated ${id}`, revalidatedTags: [`planet:${id}`] }
  }),
  'user.me': vi.fn(async (): Promise<Reply> => ({ output: 'me' })),
}

function createUtils(options: Pick<RouterUtilsOptions<TestClient>, 'prefix' | 'queryInterceptors' | 'plugins'> & { linkPlugin?: boolean } = {}) {
  const link = new StandardLink<object>(
    {
      encodeInput: async (input, path, { signal }) => ({
        method: 'POST',
        url: `/${path.join('/')}`,
        headers: {},
        body: input,
        signal,
      }),
      decodeResponse: async response => ({ kind: 'output', output: await response.resolveBody() }),
    },
    {
      send: async (request, path): Promise<StandardLazyResponse> => {
        const reply = await handlers[path.join('.') as keyof typeof handlers](request.body as any)

        return {
          status: 200,
          headers: {
            ...reply.tags && { 'orpc-cache-tag': encodeCacheTagHeader(reply.tags) },
            ...reply.revalidatedTags && { 'orpc-cache-tag-invalidation': encodeCacheTagHeader(reply.revalidatedTags) },
          },
          resolveBody: async () => reply.output,
        }
      },
    },
    { plugins: options.linkPlugin === false ? [] : [new CacheLinkPlugin()] },
  )

  return createRouterUtils(createORPCClient<TestClient>(link), {
    prefix: options.prefix,
    queryInterceptors: options.queryInterceptors,
    plugins: options.plugins ?? [new CacheRevalidationUtilsPlugin()],
  })
}

function createListOptions(utils: ReturnType<typeof createUtils>) {
  return utils.planet.list.infiniteOptions({
    input: cursor => ({ cursor }),
    initialPageParam: 0,
    getNextPageParam: (_, pages) => pages.length,
  })
}

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
}

async function observe(queryClient: QueryClient, options: any) {
  const observer = new QueryObserver(queryClient, options)
  observer.subscribe(() => {})
  await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('success'))
  return observer
}

beforeEach(() => {
  version = 0
  vi.clearAllMocks()
})

describe('experimental_CacheRevalidationUtilsPlugin', () => {
  it('refetches the active queries tagged with the revalidated tags before the mutation succeeds', async () => {
    const utils = createUtils()
    const queryClient = createQueryClient()

    const planet1 = await observe(queryClient, utils.planet.find.queryOptions({ input: { id: 1 } }))
    const planet2 = await observe(queryClient, utils.planet.find.queryOptions({ input: { id: 2 } }))
    const me = await observe(queryClient, utils.user.me.queryOptions())

    const refetch = promiseWithResolvers<void>()
    handlers['planet.find'].mockImplementationOnce(async ({ id }) => {
      await refetch.promise
      return { output: `planet ${id} v${version}`, tags: [`planet:${id}`] }
    })

    const onSuccess = vi.fn(() => queryClient.getQueryData(utils.planet.find.queryKey({ input: { id: 1 } })))
    const mutation = new MutationObserver(queryClient, utils.planet.update.mutationOptions({ onSuccess }))
    const mutate = mutation.mutate({ id: 1 })

    await vi.waitFor(() => expect(handlers['planet.find']).toHaveBeenCalledTimes(3))
    expect(mutation.getCurrentResult().status).toBe('pending')
    expect(onSuccess).not.toHaveBeenCalled()

    refetch.resolve()
    await expect(mutate).resolves.toBe('updated 1')
    expect(onSuccess).toHaveReturnedWith('planet 1 v1')

    expect(planet1.getCurrentResult().data).toBe('planet 1 v1')
    expect(planet2.getCurrentResult().data).toBe('planet 2 v0')
    expect(planet2.getCurrentResult().isStale).toBe(false)
    expect(me.getCurrentResult().isStale).toBe(false)
    expect(handlers['user.me']).toHaveBeenCalledTimes(1)
  })

  it('lets a first load in flight land before revalidating it', async () => {
    const utils = createUtils()
    const queryClient = createQueryClient()
    const refetchQueries = vi.spyOn(queryClient, 'refetchQueries')

    const load = promiseWithResolvers<void>()
    handlers['planet.find'].mockImplementationOnce(async ({ id }) => {
      const output = `planet ${id} v${version}`
      await load.promise
      return { output, tags: [`planet:${id}`] }
    })

    const planet1 = new QueryObserver(queryClient, utils.planet.find.queryOptions({ input: { id: 1 } }))
    planet1.subscribe(() => {})

    const mutation = new MutationObserver(queryClient, utils.planet.update.mutationOptions())
    const mutate = mutation.mutate({ id: 1 })

    await vi.waitFor(() => expect(refetchQueries).toHaveBeenCalled())
    load.resolve()

    await expect(mutate).resolves.toBe('updated 1')
    expect(planet1.getCurrentResult().data).toBe('planet 1 v1')
  })

  it('shares the response tags with every reader of a call', async () => {
    const seen: string[][] = []
    const utils = createUtils({
      queryInterceptors: [async ({ next, ...options }) => {
        const pluginContext = { tags: [], revalidatedTags: [] }
        const context = { ...options.context, [CACHE_LINK_PLUGIN_CONTEXT_SYMBOL]: pluginContext }
        const output = await next({ ...options, context })
        seen.push(pluginContext.tags)
        return output
      }],
      plugins: [new CacheRevalidationUtilsPlugin(), new CacheRevalidationUtilsPlugin()],
    })
    const queryClient = createQueryClient()

    const planet1 = await observe(queryClient, utils.planet.find.queryOptions({ input: { id: 1 } }))
    expect(seen).toEqual([['planet:1']])

    const mutation = new MutationObserver(queryClient, utils.planet.update.mutationOptions())
    await mutation.mutate({ id: 1 })

    expect(planet1.getCurrentResult().data).toBe('planet 1 v1')
  })

  it('marks inactive affected queries stale without waiting for them', async () => {
    const utils = createUtils()
    const queryClient = createQueryClient()

    await queryClient.fetchQuery(utils.planet.find.queryOptions({ input: { id: 1 } }))

    const mutation = new MutationObserver(queryClient, utils.planet.update.mutationOptions())
    await mutation.mutate({ id: 1 })

    expect(queryClient.getQueryState(utils.planet.find.queryKey({ input: { id: 1 } }))?.isInvalidated).toBe(true)
    expect(handlers['planet.find']).toHaveBeenCalledTimes(1)
  })

  it('succeeds the mutation even if a refetch fails', async () => {
    const utils = createUtils()
    const queryClient = createQueryClient()

    const planet1 = await observe(queryClient, utils.planet.find.queryOptions({ input: { id: 1 } }))
    handlers['planet.find'].mockRejectedValueOnce(new Error('refetch failed'))

    const mutation = new MutationObserver(queryClient, utils.planet.update.mutationOptions())
    await expect(mutation.mutate({ id: 1 })).resolves.toBe('updated 1')

    expect(planet1.getCurrentResult().status).toBe('error')
    expect(planet1.getCurrentResult().data).toBe('planet 1 v0')
  })

  it('invalidates nothing when the mutation fails or revalidates no tags', async () => {
    const utils = createUtils()
    const queryClient = createQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    await observe(queryClient, utils.planet.find.queryOptions({ input: { id: 1 } }))
    const mutation = new MutationObserver(queryClient, utils.planet.update.mutationOptions())

    handlers['planet.update'].mockRejectedValueOnce(new Error('failed'))
    await expect(mutation.mutate({ id: 1 })).rejects.toThrow('failed')

    handlers['planet.update'].mockResolvedValueOnce({ output: 'updated 1' })
    await expect(mutation.mutate({ id: 1 })).resolves.toBe('updated 1')

    expect(invalidateQueries).not.toHaveBeenCalled()
  })

  it('never invalidates from a query response', async () => {
    const utils = createUtils()
    const queryClient = createQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    handlers['user.me'].mockResolvedValueOnce({ output: 'me', revalidatedTags: ['planet:1'] })
    await observe(queryClient, utils.user.me.queryOptions())

    expect(invalidateQueries).not.toHaveBeenCalled()
  })

  it('tracks the tags of each loaded infinite query page', async () => {
    const utils = createUtils()
    const queryClient = createQueryClient()

    const observer = new InfiniteQueryObserver(queryClient, createListOptions(utils))
    observer.subscribe(() => {})
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('success'))
    await observer.fetchNextPage()

    const mutation = new MutationObserver(queryClient, utils.planet.update.mutationOptions())
    handlers['planet.update'].mockResolvedValueOnce({ output: 'updated', revalidatedTags: ['unrelated'] })
    await mutation.mutate({ id: 1 })
    expect(observer.getCurrentResult().isStale).toBe(false)

    handlers['planet.update'].mockResolvedValueOnce({ output: 'updated', revalidatedTags: ['page:0'] })
    await mutation.mutate({ id: 1 })
    expect(handlers['planet.list']).toHaveBeenCalledTimes(4)

    handlers['planet.update'].mockResolvedValueOnce({ output: 'updated', revalidatedTags: ['page:1'] })
    await mutation.mutate({ id: 1 })
    expect(handlers['planet.list']).toHaveBeenCalledTimes(6)
  })

  it('keeps tags reported during a server render through dehydration', async () => {
    const utils = createUtils()
    const serverQueryClient = createQueryClient()

    await serverQueryClient.prefetchQuery(utils.planet.find.queryOptions({ input: { id: 1 } }))
    await serverQueryClient.prefetchQuery(utils.planet.find.queryOptions({ input: { id: 2 } }))
    await serverQueryClient.prefetchInfiniteQuery({ ...createListOptions(utils), pages: 2 })

    const queryClient = createQueryClient()
    hydrate(queryClient, JSON.parse(JSON.stringify(dehydrate(serverQueryClient))))

    const planet1 = await observe(queryClient, utils.planet.find.queryOptions({ input: { id: 1 } }))
    const planet2 = await observe(queryClient, utils.planet.find.queryOptions({ input: { id: 2 } }))
    const list = new InfiniteQueryObserver(queryClient, createListOptions(utils))
    list.subscribe(() => {})

    const mutation = new MutationObserver(queryClient, utils.planet.update.mutationOptions())
    await mutation.mutate({ id: 1 })

    expect(planet1.getCurrentResult().data).toBe('planet 1 v1')
    expect(planet2.getCurrentResult().data).toBe('planet 2 v0')
    expect(list.getCurrentResult().data?.pages).toEqual([['page 0 v0'], ['page 1 v0']])
    expect(handlers['planet.find']).toHaveBeenCalledTimes(3)
    expect(handlers['planet.list']).toHaveBeenCalledTimes(2)
  })

  describe('treats data committed outside its own fetch as untracked', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(1000)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    async function revalidateUnrelated(utils: ReturnType<typeof createUtils>, queryClient: QueryClient) {
      const mutation = new MutationObserver(queryClient, utils.planet.update.mutationOptions())
      handlers['planet.update'].mockResolvedValueOnce({ output: 'updated', revalidatedTags: ['unrelated'] })
      await mutation.mutate({ id: 1 })
    }

    it('when newer data rendered without tags is hydrated over it', async () => {
      const utils = createUtils()
      const queryClient = createQueryClient()
      await observe(queryClient, utils.planet.find.queryOptions({ input: { id: 1 } }))

      vi.setSystemTime(2000)
      const serverQueryClient = createQueryClient()
      await serverQueryClient.prefetchQuery(createUtils({ linkPlugin: false }).planet.find.queryOptions({ input: { id: 1 } }))
      hydrate(queryClient, JSON.parse(JSON.stringify(dehydrate(serverQueryClient))))

      await revalidateUnrelated(utils, queryClient)
      expect(handlers['planet.find']).toHaveBeenCalledTimes(3)
    })

    it('when a pending server query is streamed over it', async () => {
      const utils = createUtils()
      const queryClient = createQueryClient()
      const planet1 = await observe(queryClient, utils.planet.find.queryOptions({ input: { id: 1 } }))

      vi.setSystemTime(2000)
      const load = promiseWithResolvers<void>()
      handlers['planet.find'].mockImplementationOnce(async ({ id }) => {
        await load.promise
        return { output: `planet ${id} streamed`, tags: [`planet:${id}`] }
      })
      const serverQueryClient = createQueryClient()
      void serverQueryClient.prefetchQuery(utils.planet.find.queryOptions({ input: { id: 1 } }))
      hydrate(queryClient, dehydrate(serverQueryClient, { shouldDehydrateQuery: () => true }))
      load.resolve()
      await vi.waitFor(() => expect(planet1.getCurrentResult().data).toBe('planet 1 streamed'))

      await revalidateUnrelated(utils, queryClient)
      expect(handlers['planet.find']).toHaveBeenCalledTimes(3)
    })

    it('when it is set with setQueryData', async () => {
      const utils = createUtils()
      const queryClient = createQueryClient()
      await observe(queryClient, utils.planet.find.queryOptions({ input: { id: 1 } }))

      queryClient.setQueryData(utils.planet.find.queryKey({ input: { id: 1 } }), 'optimistic')

      await revalidateUnrelated(utils, queryClient)
      expect(handlers['planet.find']).toHaveBeenCalledTimes(2)
    })
  })

  it('trims the page tags of a full infinite fetch beyond maxPages', async () => {
    const utils = createUtils()
    const queryClient = createQueryClient()
    const listOptions = { ...createListOptions(utils), maxPages: 2 }

    await queryClient.prefetchInfiniteQuery({ ...listOptions, pages: 3 })
    expect(queryClient.getQueryData(listOptions.queryKey)?.pages).toEqual([['page 1 v0'], ['page 2 v0']])

    const mutation = new MutationObserver(queryClient, utils.planet.update.mutationOptions())
    handlers['planet.update'].mockResolvedValueOnce({ output: 'updated', revalidatedTags: ['page:0'] })
    await mutation.mutate({ id: 1 })
    expect(queryClient.getQueryState(listOptions.queryKey)?.isInvalidated).toBe(false)

    handlers['planet.update'].mockResolvedValueOnce({ output: 'updated', revalidatedTags: ['page:2'] })
    await mutation.mutate({ id: 1 })
    expect(queryClient.getQueryState(listOptions.queryKey)?.isInvalidated).toBe(true)
  })

  it('revalidates hydrated queries rendered without tags until a fetch reveals them', async () => {
    const utils = createUtils({ prefix: 'api' })
    const serverUtils = createUtils({ prefix: 'api', linkPlugin: false })
    const serverQueryClient = createQueryClient()

    const planet1Options = utils.planet.find.queryOptions({ input: { id: 1 } })
    const planet2Options = utils.planet.find.queryOptions({ input: { id: 2 } })
    const listOptions = createListOptions(utils)
    const streamedKey = utils.planet.find.key({ type: 'streamed' })
    const otherPrefixKey = createUtils({ prefix: 'other' }).planet.find.queryKey({ input: { id: 1 } })

    await serverQueryClient.prefetchQuery(serverUtils.planet.find.queryOptions({ input: { id: 1 } }))
    await serverQueryClient.prefetchQuery(serverUtils.planet.find.queryOptions({ input: { id: 2 } }))
    await serverQueryClient.prefetchInfiniteQuery(createListOptions(serverUtils))
    serverQueryClient.setQueryData(streamedKey, ['streamed'])
    serverQueryClient.setQueryData(otherPrefixKey, 'other prefix')
    serverQueryClient.setQueryData(['custom'], 'custom')

    const queryClient = createQueryClient()
    hydrate(queryClient, dehydrate(serverQueryClient))

    const planet1 = await observe(queryClient, planet1Options)
    const planet2 = await observe(queryClient, planet2Options)
    const list = new InfiniteQueryObserver(queryClient, listOptions)
    list.subscribe(() => {})
    await list.fetchNextPage()

    const mutation = new MutationObserver(queryClient, utils.planet.update.mutationOptions())
    await mutation.mutate({ id: 1 })

    expect(planet1.getCurrentResult().data).toBe('planet 1 v1')
    expect(planet2.getCurrentResult().data).toBe('planet 2 v1')
    expect(list.getCurrentResult().data?.pages).toEqual([['page 0 v1'], ['page 1 v1']])
    expect(queryClient.getQueryState(streamedKey)?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(otherPrefixKey)?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(['custom'])?.isInvalidated).toBe(false)

    await mutation.mutate({ id: 2 })

    expect(planet1.getCurrentResult().data).toBe('planet 1 v1')
    expect(planet2.getCurrentResult().data).toBe('planet 2 v2')
    expect(list.getCurrentResult().data?.pages).toEqual([['page 0 v1'], ['page 1 v1']])
  })

  it('lines up infinite query page tags with pages fetched in either direction under maxPages', async () => {
    const utils = createUtils()
    const queryClient = createQueryClient()

    const observer = new InfiniteQueryObserver(queryClient, utils.planet.list.infiniteOptions({
      input: cursor => ({ cursor }),
      initialPageParam: 1,
      getNextPageParam: (_, __, last) => last + 1,
      getPreviousPageParam: (_, __, first) => first - 1,
      maxPages: 2,
    }))
    observer.subscribe(() => {})
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('success'))
    await observer.fetchNextPage()
    await observer.fetchPreviousPage()
    expect(observer.getCurrentResult().data?.pages).toEqual([['page 0 v0'], ['page 1 v0']])

    const mutation = new MutationObserver(queryClient, utils.planet.update.mutationOptions())
    handlers['planet.update'].mockResolvedValueOnce({ output: 'updated', revalidatedTags: ['page:2'] })
    await mutation.mutate({ id: 1 })
    expect(handlers['planet.list']).toHaveBeenCalledTimes(3)

    handlers['planet.update'].mockResolvedValueOnce({ output: 'updated', revalidatedTags: ['page:0'] })
    await mutation.mutate({ id: 1 })
    expect(handlers['planet.list']).toHaveBeenCalledTimes(5)
  })

  it('tracks a first page fetched as the next page', async () => {
    const utils = createUtils()
    const queryClient = createQueryClient()

    const observer = new InfiniteQueryObserver(queryClient, { ...createListOptions(utils), enabled: false })
    await observer.fetchNextPage()
    expect(observer.getCurrentResult().data?.pages).toEqual([['page 0 v0']])

    const mutation = new MutationObserver(queryClient, utils.planet.update.mutationOptions())
    handlers['planet.update'].mockResolvedValueOnce({ output: 'updated', revalidatedTags: ['unrelated'] })
    await mutation.mutate({ id: 1 })
    expect(observer.getCurrentResult().isStale).toBe(false)

    handlers['planet.update'].mockResolvedValueOnce({ output: 'updated', revalidatedTags: ['page:0'] })
    await mutation.mutate({ id: 1 })
    expect(queryClient.getQueryState(createListOptions(utils).queryKey)?.isInvalidated).toBe(true)
  })

  it('does not pair a fetched page with tags left over from a failed refetch', async () => {
    const utils = createUtils()
    const queryClient = createQueryClient()

    const observer = new InfiniteQueryObserver(queryClient, { ...createListOptions(utils), maxPages: 2 })
    observer.subscribe(() => {})
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('success'))
    await observer.fetchNextPage()

    handlers['planet.list'].mockResolvedValueOnce({ output: ['page 0 changed'], tags: ['changed'] })
    handlers['planet.list'].mockRejectedValueOnce(new Error('page failed'))
    await observer.refetch()
    await observer.fetchNextPage()
    expect(observer.getCurrentResult().data?.pages).toEqual([['page 1 v0'], ['page 2 v0']])

    const mutation = new MutationObserver(queryClient, utils.planet.update.mutationOptions())
    handlers['planet.update'].mockResolvedValueOnce({ output: 'updated', revalidatedTags: ['page:1'] })
    await mutation.mutate({ id: 1 })

    expect(handlers['planet.list']).toHaveBeenCalledTimes(7)
  })

  it('keeps infinite query page tags lined up when a refetch of all pages retries', async () => {
    const utils = createUtils()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0, staleTime: Infinity } } })

    const observer = new InfiniteQueryObserver(queryClient, createListOptions(utils))
    observer.subscribe(() => {})
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('success'))
    await observer.fetchNextPage()

    handlers['planet.list'].mockImplementationOnce(async ({ cursor }) => ({ output: [`page ${cursor} v${version}`], tags: [`page:${cursor}`] }))
    handlers['planet.list'].mockRejectedValueOnce(new Error('page failed'))
    await observer.refetch()
    expect(handlers['planet.list']).toHaveBeenCalledTimes(5)

    const mutation = new MutationObserver(queryClient, utils.planet.update.mutationOptions())
    handlers['planet.update'].mockResolvedValueOnce({ output: 'updated', revalidatedTags: ['unrelated'] })
    await mutation.mutate({ id: 1 })

    expect(handlers['planet.list']).toHaveBeenCalledTimes(5)
  })

  it('does not trust page tags from a refetch that failed partway', async () => {
    const utils = createUtils()
    const queryClient = createQueryClient()

    const observer = new InfiniteQueryObserver(queryClient, createListOptions(utils))
    observer.subscribe(() => {})
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('success'))
    await observer.fetchNextPage()

    handlers['planet.list'].mockResolvedValueOnce({ output: ['page 0 changed'], tags: ['changed'] })
    handlers['planet.list'].mockRejectedValueOnce(new Error('page failed'))
    await observer.refetch()
    expect(observer.getCurrentResult().data?.pages).toEqual([['page 0 v0'], ['page 1 v0']])

    const mutation = new MutationObserver(queryClient, utils.planet.update.mutationOptions())
    handlers['planet.update'].mockResolvedValueOnce({ output: 'updated', revalidatedTags: ['page:0'] })
    await mutation.mutate({ id: 1 })

    expect(handlers['planet.list']).toHaveBeenCalledTimes(6)
  })

  it('matches infinite query pages by page param value', async () => {
    const utils = createUtils()
    const queryClient = createQueryClient()

    const observer = new InfiniteQueryObserver(queryClient, utils.planet.list.infiniteOptions({
      input: ({ index }: { index: number }) => ({ cursor: index }),
      initialPageParam: { index: 0 },
      getNextPageParam: (_, pages) => ({ index: pages.length }),
    }))
    observer.subscribe(() => {})
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('success'))
    await observer.fetchNextPage()

    // the refetch gets an equal cursor, but structural sharing keeps the earlier one in the data
    const mutation = new MutationObserver(queryClient, utils.planet.update.mutationOptions())
    handlers['planet.update'].mockResolvedValueOnce({ output: 'updated', revalidatedTags: ['page:1'] })
    await mutation.mutate({ id: 1 })
    expect(handlers['planet.list']).toHaveBeenCalledTimes(4)

    handlers['planet.update'].mockResolvedValueOnce({ output: 'updated', revalidatedTags: ['unrelated'] })
    await mutation.mutate({ id: 1 })
    expect(handlers['planet.list']).toHaveBeenCalledTimes(4)
  })

  it('keeps distinct infinite query page params apart even when they serialize alike', async () => {
    const utils = createUtils()
    const queryClient = createQueryClient()

    const observer = new InfiniteQueryObserver(queryClient, utils.planet.list.infiniteOptions({
      input: (cursor: Map<string, number>) => ({ cursor: cursor.get('index')! }),
      initialPageParam: new Map([['index', 0]]),
      getNextPageParam: (_, pages) => new Map([['index', pages.length]]),
    }))
    observer.subscribe(() => {})
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('success'))
    await observer.fetchNextPage()

    const mutation = new MutationObserver(queryClient, utils.planet.update.mutationOptions())
    handlers['planet.update'].mockResolvedValueOnce({ output: 'updated', revalidatedTags: ['page:0'] })
    await mutation.mutate({ id: 1 })

    expect(handlers['planet.list']).toHaveBeenCalledTimes(4)
  })

  it('matches infinite query page params that JSON cannot serialize', async () => {
    const utils = createUtils()
    const queryClient = createQueryClient()

    const observer = new InfiniteQueryObserver(queryClient, utils.planet.list.infiniteOptions({
      input: ({ index }: { index: bigint }) => ({ cursor: Number(index) }),
      initialPageParam: { index: 0n },
      getNextPageParam: () => undefined,
    }))
    observer.subscribe(() => {})
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('success'))

    const mutation = new MutationObserver(queryClient, utils.planet.update.mutationOptions())
    handlers['planet.update'].mockResolvedValueOnce({ output: 'updated', revalidatedTags: ['unrelated'] })
    await mutation.mutate({ id: 1 })
    expect(handlers['planet.list']).toHaveBeenCalledTimes(1)

    handlers['planet.update'].mockResolvedValueOnce({ output: 'updated', revalidatedTags: ['page:0'] })
    await mutation.mutate({ id: 1 })
    expect(handlers['planet.list']).toHaveBeenCalledTimes(2)
  })

  it('leaves queries that never loaded data alone', async () => {
    const utils = createUtils()
    const queryClient = createQueryClient()

    handlers['planet.find'].mockRejectedValueOnce(new Error('not found'))
    const planet1 = new QueryObserver(queryClient, utils.planet.find.queryOptions({ input: { id: 1 } }))
    planet1.subscribe(() => {})
    await vi.waitFor(() => expect(planet1.getCurrentResult().status).toBe('error'))

    const mutation = new MutationObserver(queryClient, utils.planet.update.mutationOptions())
    await mutation.mutate({ id: 1 })

    expect(handlers['planet.find']).toHaveBeenCalledTimes(1)
  })

  it('leaves infinite queries reset to no data alone', async () => {
    const utils = createUtils()
    const queryClient = createQueryClient()
    const listOptions = createListOptions(utils)

    await queryClient.fetchInfiniteQuery(listOptions)
    await queryClient.resetQueries({ queryKey: listOptions.queryKey })

    const mutation = new MutationObserver(queryClient, utils.planet.update.mutationOptions())
    handlers['planet.update'].mockResolvedValueOnce({ output: 'updated', revalidatedTags: ['page:0'] })
    await mutation.mutate({ id: 1 })

    expect(queryClient.getQueryState(listOptions.queryKey)?.isInvalidated).toBe(false)
  })

  it('revalidates infinite query pages a failed refetch left behind', async () => {
    const utils = createUtils()
    const listOptions = createListOptions(utils)

    const serverQueryClient = createQueryClient()
    await serverQueryClient.prefetchInfiniteQuery({ ...listOptions, pages: 2 })

    const queryClient = createQueryClient()
    hydrate(queryClient, dehydrate(serverQueryClient))

    const list = new InfiniteQueryObserver(queryClient, listOptions)
    list.subscribe(() => {})
    handlers['planet.list'].mockImplementationOnce(async ({ cursor }) => ({ output: [`page ${cursor} v${version}`], tags: [`page:${cursor}`] }))
    handlers['planet.list'].mockRejectedValueOnce(new Error('page failed'))
    await list.refetch()
    expect(list.getCurrentResult().data?.pages).toEqual([['page 0 v0'], ['page 1 v0']])

    const mutation = new MutationObserver(queryClient, utils.planet.update.mutationOptions())
    handlers['planet.update'].mockImplementationOnce(async () => {
      version++
      return { output: 'updated', revalidatedTags: ['page:1'] }
    })
    await mutation.mutate({ id: 1 })

    expect(list.getCurrentResult().data?.pages).toEqual([['page 0 v1'], ['page 1 v1']])
  })

  it('treats queries fetched without reported tags as unknown', async () => {
    const utils = createUtils()
    const queryClient = createQueryClient()

    const planet1 = await observe(queryClient, createUtils({ linkPlugin: false }).planet.find.queryOptions({ input: { id: 1 } }))

    const mutation = new MutationObserver(queryClient, utils.planet.update.mutationOptions())
    handlers['planet.update'].mockResolvedValueOnce({ output: 'updated', revalidatedTags: ['unrelated'] })
    await mutation.mutate({ id: 1 })

    expect(planet1.getCurrentResult().data).toBe('planet 1 v0')
    expect(handlers['planet.find']).toHaveBeenCalledTimes(2)
  })

  it('passes through query functions called outside the query cache', async () => {
    const utils = createUtils()
    const queryClient = createQueryClient()
    const fnContext = { client: queryClient, signal: new AbortController().signal, meta: undefined }

    const query = utils.planet.find.queryOptions({ input: { id: 1 } })
    await expect(query.queryFn({ ...fnContext, queryKey: query.queryKey })).resolves.toBe('planet 1 v0')

    const infinite = createListOptions(utils)
    await expect(infinite.queryFn({ ...fnContext, queryKey: infinite.queryKey, pageParam: 0, direction: 'forward' })).resolves.toEqual(['page 0 v0'])

    expect(queryClient.getQueryCache().getAll()).toEqual([])
  })

  it('keeps the tags of each query client apart', async () => {
    const utils = createUtils()
    const queryClient1 = createQueryClient()
    const queryClient2 = createQueryClient()

    const planet1 = await observe(queryClient1, utils.planet.find.queryOptions({ input: { id: 1 } }))
    const planet2 = await observe(queryClient2, utils.planet.find.queryOptions({ input: { id: 1 } }))

    const mutation = new MutationObserver(queryClient1, utils.planet.update.mutationOptions())
    await mutation.mutate({ id: 1 })

    expect(planet1.getCurrentResult().data).toBe('planet 1 v1')
    expect(planet2.getCurrentResult().data).toBe('planet 1 v0')
    expect(planet2.getCurrentResult().isStale).toBe(false)
  })
})
