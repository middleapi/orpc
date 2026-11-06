import type { Client } from '@orpc/client'
import { RPCJsonSerializer } from '@orpc/client'
import { sleep } from '@orpc/shared'
import type { QueryObserverOptions } from '@tanstack/query-core'
import {
  defaultShouldDehydrateQuery,
  dehydrate,
  environmentManager,
  hydrate,
  QueryClient,
  QueryObserver,
} from '@tanstack/query-core'

import { distinctData } from '../tests/__shared__/utils.ts'
import { createRouterUtils } from './router-utils.ts'
import { createHydrationOptions, StreamQuerySSRUtilsPlugin } from './ssr.ts'

describe('createHydrationOptions', () => {
  function roundTrip(data: unknown, options = createHydrationOptions()): unknown {
    const server = new QueryClient({ defaultOptions: options })
    const browser = new QueryClient({ defaultOptions: options })

    server.setQueryData(['key'], data)
    hydrate(browser, JSON.parse(JSON.stringify(dehydrate(server))))

    return browser.getQueryData(['key'])
  }

  it('preserves oRPC types through dehydrate and hydrate', () => {
    const data = {
      date: new Date('2024-01-01'),
      bigint: 1n,
      set: new Set([1, 2]),
      map: new Map([['a', 1]]),
      url: new URL('https://orpc.dev'),
      undefined,
      nested: [{ date: new Date(0) }],
    }

    expect(roundTrip(data)).toEqual(data)
  })

  it('uses the given serializer', () => {
    class Person {
      constructor(public name: string) {}
    }

    const options = createHydrationOptions(
      new RPCJsonSerializer({
        handlers: {
          person: {
            condition: (value) => value instanceof Person,
            serialize: (value: Person) => value.name,
            deserialize: (name) => new Person(name as string),
          },
        },
      }),
    )

    expect(roundTrip({ person: new Person('Earth') }, options)).toEqual({
      person: new Person('Earth'),
    })
  })

  it('drops maps and blobs, which do not survive JSON', () => {
    const { dehydrate } = createHydrationOptions()

    expect(Object.keys(dehydrate.serializeData({ blob: new Blob(['hello']) }))).toEqual([
      'json',
      'meta',
    ])
  })
})

describe('streamQuerySSRUtilsPlugin', () => {
  const started = vi.fn()
  const cleanup = vi.fn()
  const client = {
    stream: vi.fn(async (_input: undefined, { signal }: { signal: AbortSignal }) => {
      await sleep(10)
      return (async function* () {
        started()
        try {
          yield 1
          await sleep(10)
          yield 2
          await new Promise((_, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason)),
          )
        } finally {
          cleanup()
        }
      })()
    }),
  } as unknown as { stream: Client<object, undefined, AsyncIterable<number>, Error> }

  const finiteClient = {
    stream: vi.fn(async function* () {
      yield 1
      yield 2
    }),
  } as unknown as typeof client

  function callSignal(index = 0): AbortSignal {
    return vi.mocked(client.stream).mock.calls[index]![1]!.signal!
  }

  function createUtils(isServer: boolean, streamClient = client) {
    return createRouterUtils(streamClient, {
      plugins: [new StreamQuerySSRUtilsPlugin({ isServer })],
    })
  }

  function observe(
    queryClient: QueryClient,
    options: QueryObserverOptions<any, any, any, any, any>,
  ) {
    const observer = new QueryObserver(queryClient, options)
    const results = [observer.getCurrentResult()]
    onTestFinished(observer.subscribe((result) => results.push(result)))
    return { observer, results }
  }

  function createQueryClient(
    options: ConstructorParameters<typeof QueryClient>[0] = {},
  ): QueryClient {
    const queryClient = new QueryClient(options)
    onTestFinished(() => queryClient.cancelQueries())
    return queryClient
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('on the server', () => {
    it('settles streamed queries once they connect', async () => {
      const queryClient = createQueryClient()
      const options = createUtils(true).stream.streamedOptions()

      await expect(queryClient.fetchQuery(options)).resolves.toEqual([])
      expect(queryClient.getQueryState(options.queryKey)).toMatchObject({ isInvalidated: true })
    })

    it('settles live queries on their first event', async () => {
      const queryClient = createQueryClient()
      const options = createUtils(true).stream.liveOptions()

      await expect(queryClient.fetchQuery(options)).resolves.toBe(1)
      expect(queryClient.getQueryState(options.queryKey)).toMatchObject({ isInvalidated: true })
    })

    it('settles even when an observer is subscribed, as vue and svelte do on the server', async () => {
      const queryClient = createQueryClient()
      const { observer } = observe(queryClient, createUtils(true).stream.streamedOptions())

      await vi.waitFor(() =>
        expect(observer.getCurrentResult()).toMatchObject({
          status: 'success',
          fetchStatus: 'idle',
          data: [],
        }),
      )
      expect(queryClient.getQueryState(observer.options.queryKey)).toMatchObject({
        isInvalidated: true,
      })

      await sleep(30)
      expect(client.stream).toHaveBeenCalledTimes(1)
      expect(started).not.toHaveBeenCalled()
    })

    it('waits for a finite stream to end with a per-call settleOnFirstData: false', async () => {
      const queryClient = createQueryClient()
      const utils = createUtils(true, finiteClient)

      await expect(
        queryClient.fetchQuery(utils.stream.streamedOptions({ settleOnFirstData: false })),
      ).resolves.toEqual([1, 2])
      await expect(
        queryClient.fetchQuery(utils.stream.liveOptions({ settleOnFirstData: false })),
      ).resolves.toBe(2)
    })

    it('lets utils-level options override settleOnFirstData', async () => {
      const queryClient = createQueryClient()
      const utils = createRouterUtils(finiteClient, {
        plugins: [new StreamQuerySSRUtilsPlugin({ isServer: true })],
        scoped: { stream: { streamedOptions: { settleOnFirstData: false } } },
      })

      await expect(queryClient.fetchQuery(utils.stream.streamedOptions())).resolves.toEqual([1, 2])
      await expect(queryClient.fetchQuery(utils.stream.liveOptions())).resolves.toBe(1)
    })

    it.each([
      ['streamed', []],
      ['live', 1],
    ] as const)(
      'resolves next() in an interceptor when the fetch settles (%s)',
      async (type, firstData) => {
        const interceptor = vi.fn((options: any) => options.next())
        const utils = createRouterUtils(client, {
          plugins: [new StreamQuerySSRUtilsPlugin({ isServer: true })],
          streamedInterceptors: [interceptor],
          liveInterceptors: [interceptor],
        }).stream

        await createQueryClient().fetchQuery(
          (type === 'streamed' ? utils.streamedOptions() : utils.liveOptions()) as any,
        )
        await expect(interceptor.mock.results[0]!.value).resolves.toEqual(firstData)
      },
    )
  })

  describe('in the browser', () => {
    it('follows the stream to its end, even for a fetch nothing observes', async () => {
      const queryClient = createQueryClient()
      const utils = createUtils(false, finiteClient).stream

      await expect(queryClient.fetchQuery(utils.streamedOptions())).resolves.toEqual([1, 2])
      await expect(queryClient.fetchQuery(utils.liveOptions())).resolves.toBe(2)
    })

    it.each([
      ['streamed', [], [1, 2]],
      ['live', 1, 2],
    ] as const)(
      'resumes a suspense fetch at its first data while the stream keeps going (%s)',
      async (type, firstData, laterData) => {
        const queryClient = createQueryClient()
        const utils = createUtils(false).stream
        const options: QueryObserverOptions<any, any, any, any, any> = {
          ...(type === 'streamed' ? utils.streamedOptions() : utils.liveOptions()),
          suspense: true,
        }

        // what useSuspenseQuery throws to suspend
        await expect(
          new QueryObserver(queryClient, options).fetchOptimistic(options),
        ).resolves.toMatchObject({ data: firstData })

        const { observer } = observe(queryClient, options)
        await vi.waitFor(() =>
          expect(observer.getCurrentResult()).toMatchObject({
            data: laterData,
            fetchStatus: 'fetching',
          }),
        )
        expect(client.stream).toHaveBeenCalledTimes(1)
      },
    )

    it.each([
      ['streamed', [1, 2]],
      ['live', 2],
    ] as const)(
      'reopens a stream cut off by unmount when it remounts within staleTime (%s)',
      async (type, data) => {
        const queryClient = createQueryClient({
          defaultOptions: { queries: { staleTime: 60_000 } },
        })
        const utils = createUtils(false).stream
        const options: QueryObserverOptions<any, any, any, any, any> =
          type === 'streamed' ? utils.streamedOptions() : utils.liveOptions()

        const unsubscribe = new QueryObserver(queryClient, options).subscribe(() => {})
        await vi.waitFor(() => expect(queryClient.getQueryData(options.queryKey)).toEqual(data))
        unsubscribe()

        expect(callSignal().aborted).toBe(true)
        expect(queryClient.getQueryState(options.queryKey)).toMatchObject({
          data,
          fetchStatus: 'idle',
          isInvalidated: true,
        })

        const { observer, results } = observe(queryClient, options)

        await vi.waitFor(() =>
          expect(observer.getCurrentResult()).toMatchObject({ fetchStatus: 'fetching' }),
        )
        expect(results.map((result) => result.status)).not.toContain('pending')
        expect(client.stream).toHaveBeenCalledTimes(2)
      },
    )
  })

  describe('end to end with hydration', () => {
    function createSSRQueryClient(staleTime: number | 'static' = 60_000): QueryClient {
      return createQueryClient({
        defaultOptions: { queries: { staleTime }, ...createHydrationOptions() },
      })
    }

    function getOptions(
      isServer: boolean,
      type: 'streamed' | 'live',
    ): QueryObserverOptions<any, any, any, any, any> {
      const utils = createUtils(isServer).stream
      return type === 'streamed' ? utils.streamedOptions() : utils.liveOptions()
    }

    async function renderOnServer(type: 'streamed' | 'live', browser: QueryClient): Promise<void> {
      const server = createSSRQueryClient()
      await server.prefetchQuery(getOptions(true, type))
      hydrate(browser, JSON.parse(JSON.stringify(dehydrate(server))))
    }

    it.each([
      ['streamed', [], [[], [1], [1, 2]]],
      ['live', 1, [1, 2]],
    ] as const)(
      'reopens the stream on mount despite staleTime, keeping the server data on screen (%s)',
      async (type, firstData, sequence) => {
        const browser = createSSRQueryClient()
        await renderOnServer(type, browser)

        const options = getOptions(false, type)
        expect(browser.getQueryState(options.queryKey)).toMatchObject({
          status: 'success',
          data: firstData,
          isInvalidated: true,
        })

        const { observer, results } = observe(browser, options)

        await vi.waitFor(() =>
          expect(observer.getCurrentResult()).toMatchObject({
            data: sequence.at(-1),
            fetchStatus: 'fetching',
          }),
        )
        expect(results.map((result) => result.status)).not.toContain('pending')
        expect(distinctData(results)).toEqual(sequence)
      },
    )

    it.each([
      ['streamed', [], [[], [1], [1, 2]]],
      ['live', 1, [1, 2]],
    ] as const)(
      'hydrates a query dehydrated while pending with its first data, then reopens the stream on mount (%s)',
      async (type, firstData, sequence) => {
        const server = createSSRQueryClient()
        const browser = createSSRQueryClient()
        void server.prefetchQuery(getOptions(true, type))
        hydrate(
          browser,
          dehydrate(server, {
            shouldDehydrateQuery: (query) =>
              defaultShouldDehydrateQuery(query) || query.state.status === 'pending',
          }),
        )

        const options = getOptions(false, type)
        await vi.waitFor(() =>
          expect(browser.getQueryState(options.queryKey)).toMatchObject({ fetchStatus: 'idle' }),
        )
        expect(browser.getQueryState(options.queryKey)).toMatchObject({
          status: 'success',
          data: firstData,
        })

        const { observer, results } = observe(browser, options)

        await vi.waitFor(() =>
          expect(observer.getCurrentResult()).toMatchObject({
            data: sequence.at(-1),
            fetchStatus: 'fetching',
          }),
        )
        expect(distinctData(results)).toEqual(sequence)
        expect(client.stream).toHaveBeenCalledTimes(2)
      },
    )

    it('does not reopen the stream with staleTime: static', async () => {
      const browser = createSSRQueryClient('static')
      await renderOnServer('streamed', browser)

      const { observer } = observe(browser, getOptions(false, 'streamed'))

      await sleep(30)
      expect(observer.getCurrentResult()).toMatchObject({ data: [], fetchStatus: 'idle' })
      expect(client.stream).toHaveBeenCalledTimes(1)
    })
  })

  it("defaults to TanStack Query's server detection", () => {
    const isServer = environmentManager.isServer()
    try {
      environmentManager.setIsServer(() => true)
      expect(new StreamQuerySSRUtilsPlugin().initProcedureOptions([], {})).toEqual({
        streamedOptions: { settleOnFirstData: true, refetchOnMount: false },
        liveOptions: { settleOnFirstData: true, refetchOnMount: false },
      })

      environmentManager.setIsServer(() => false)
      expect(new StreamQuerySSRUtilsPlugin().initProcedureOptions([], {})).toEqual({
        streamedOptions: { refetchOnMount: 'always' },
        liveOptions: { refetchOnMount: 'always' },
      })
    } finally {
      environmentManager.setIsServer(() => isServer)
    }
  })
})
