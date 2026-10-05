import type { CacheContext, CacheLinkPluginContext } from '@orpc/experimental-cache'
import type { RouterClient } from '@orpc/server'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { BatchLinkPlugin } from '@orpc/client/plugins'
import { cache, CACHE_LINK_PLUGIN_CONTEXT_SYMBOL, CacheHandlerPlugin, CacheLinkPlugin, cacheRouterClientInterceptor, revalidate } from '@orpc/experimental-cache'
import { MemoryCacheStore } from '@orpc/experimental-cache/memory'
import { createRouterClient, os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { BatchHandlerPlugin } from '@orpc/server/plugins'
import { promiseWithResolvers } from '@orpc/shared'
import { dehydrate, hydrate, MutationObserver, QueryClient, QueryObserver } from '@tanstack/query-core'
import { z } from 'zod'
import { createTanstackQueryUtils, experimental_CacheRevalidationUtilsPlugin } from '../src'

function setup() {
  const planets = new Map([[1, 'Earth'], [2, 'Mars']])
  const find = vi.fn(async ({ input }: { input: { id: number } }) => planets.get(input.id))

  const base = os.$context<CacheContext>()
  const router = {
    planet: {
      find: base
        .input(z.object({ id: z.number() }))
        .use(cache({ tags: (_, input) => [`planet:${input.id}`] }))
        .handler(find),
      rename: base
        .input(z.object({ id: z.number(), name: z.string() }))
        .use(revalidate({ tags: (_, input) => [`planet:${input.id}`] }))
        .handler(({ input }) => {
          planets.set(input.id, input.name)
          return input.name
        }),
    },
  }

  const store = new MemoryCacheStore()
  const handler = new RPCHandler(router, {
    plugins: [
      new BatchHandlerPlugin(),
      new CacheHandlerPlugin({ headers: ['orpc-cache-tag', 'orpc-cache-tag-invalidation'] }),
    ],
  })

  const fetch = vi.fn(async (...args: ConstructorParameters<typeof Request>) => {
    const { response } = await handler.handle(new Request(...args), { context: { 'cache/store': store } })
    return response ?? new Response('Not Found', { status: 404 })
  })

  const client: RouterClient<typeof router> = createORPCClient(new RPCLink({
    origin: 'http://localhost',
    fetch,
    plugins: [
      new BatchLinkPlugin({ groups: [{ condition: () => true, context: {} }] }),
      new CacheLinkPlugin(),
    ],
  }))

  const orpc = createTanstackQueryUtils(client, {
    plugins: [new experimental_CacheRevalidationUtilsPlugin()],
  })

  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })

  const serverClient: RouterClient<typeof router, CacheLinkPluginContext> = createRouterClient(router, {
    context: (clientContext: CacheLinkPluginContext) => ({
      'cache/store': store,
      [CACHE_LINK_PLUGIN_CONTEXT_SYMBOL]: clientContext[CACHE_LINK_PLUGIN_CONTEXT_SYMBOL],
    }),
    interceptors: [cacheRouterClientInterceptor],
  })

  const serverORPC = createTanstackQueryUtils(serverClient, {
    plugins: [new experimental_CacheRevalidationUtilsPlugin()],
  })

  return { planets, find, fetch, orpc, serverORPC, queryClient }
}

it('refetches the queries a mutation revalidates through batched requests', async () => {
  const { find, fetch, orpc, queryClient } = setup()

  const earth = new QueryObserver(queryClient, orpc.planet.find.queryOptions({ input: { id: 1 } }))
  const mars = new QueryObserver(queryClient, orpc.planet.find.queryOptions({ input: { id: 2 } }))
  earth.subscribe(() => {})
  mars.subscribe(() => {})
  await vi.waitFor(() => {
    expect(earth.getCurrentResult().data).toBe('Earth')
    expect(mars.getCurrentResult().data).toBe('Mars')
  })
  expect(fetch).toHaveBeenCalledTimes(1)

  const rename = new MutationObserver(queryClient, orpc.planet.rename.mutationOptions())
  await expect(rename.mutate({ id: 1, name: 'Terra' })).resolves.toBe('Terra')

  expect(earth.getCurrentResult().data).toBe('Terra')
  expect(mars.getCurrentResult().isStale).toBe(false)
  expect(find).toHaveBeenCalledTimes(3)
})

it('refetches a query whose first load was batched with the mutation', async () => {
  const { planets, find, fetch, orpc, queryClient } = setup()
  const refetchQueries = vi.spyOn(queryClient, 'refetchQueries')

  // the load reads before the rename writes, and answers after the rename does
  const load = promiseWithResolvers<void>()
  find.mockImplementationOnce(async ({ input }) => {
    const name = planets.get(input.id)
    await load.promise
    return name
  })

  const earth = new QueryObserver(queryClient, orpc.planet.find.queryOptions({ input: { id: 1 } }))
  earth.subscribe(() => {})
  const rename = new MutationObserver(queryClient, orpc.planet.rename.mutationOptions())
  const renamed = rename.mutate({ id: 1, name: 'Terra' })

  await vi.waitFor(() => expect(refetchQueries).toHaveBeenCalled())
  expect(fetch).toHaveBeenCalledTimes(1)
  load.resolve()

  await expect(renamed).resolves.toBe('Terra')
  expect(earth.getCurrentResult().data).toBe('Terra')
})

it('keeps the tags of a server render through createRouterClient after hydration', async () => {
  const { find, orpc, serverORPC, queryClient } = setup()

  const serverQueryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  await serverQueryClient.prefetchQuery(serverORPC.planet.find.queryOptions({ input: { id: 1 } }))
  await serverQueryClient.prefetchQuery(serverORPC.planet.find.queryOptions({ input: { id: 2 } }))
  hydrate(queryClient, JSON.parse(JSON.stringify(dehydrate(serverQueryClient))))

  const earth = new QueryObserver(queryClient, orpc.planet.find.queryOptions({ input: { id: 1 } }))
  const mars = new QueryObserver(queryClient, orpc.planet.find.queryOptions({ input: { id: 2 } }))
  earth.subscribe(() => {})
  mars.subscribe(() => {})

  const rename = new MutationObserver(queryClient, orpc.planet.rename.mutationOptions())
  await expect(rename.mutate({ id: 1, name: 'Terra' })).resolves.toBe('Terra')

  expect(earth.getCurrentResult().data).toBe('Terra')
  expect(queryClient.getQueryState(orpc.planet.find.queryKey({ input: { id: 2 } }))?.dataUpdateCount).toBe(1)
  expect(find).toHaveBeenCalledTimes(3)
})
