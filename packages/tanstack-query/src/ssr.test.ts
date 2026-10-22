import type { Client } from '@orpc/client'
import { RPCJsonSerializer } from '@orpc/client'
import { sleep } from '@orpc/shared'
import { dehydrate, hydrate, QueryCache, QueryClient } from '@tanstack/query-core'
import { createRouterUtils } from './router-utils'
import { createHydrationOptions, StreamQuerySSRUtilsPlugin } from './ssr'

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

    const options = createHydrationOptions(new RPCJsonSerializer({
      handlers: {
        person: {
          condition: value => value instanceof Person,
          serialize: (value: Person) => value.name,
          deserialize: name => new Person(name as string),
        },
      },
    }))

    expect(roundTrip({ person: new Person('Earth') }, options)).toEqual({ person: new Person('Earth') })
  })

  it('drops maps and blobs, which do not survive JSON', () => {
    const { dehydrate } = createHydrationOptions()

    expect(Object.keys(dehydrate.serializeData({ blob: new Blob(['hello']) }))).toEqual(['json', 'meta'])
  })
})

describe('streamQuerySSRUtilsPlugin', () => {
  const cleanup = vi.fn()
  const client = {
    stream: vi.fn(async function* () {
      try {
        yield 1

        while (true) {
          await sleep(10)
          yield 2
        }
      }
      finally {
        cleanup()
      }
    }),
  } as unknown as { stream: Client<object, undefined, AsyncIterable<number>, Error> }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('cancels live queries on their first event on the server', async () => {
    const onSuccess = vi.fn()
    const queryClient = new QueryClient({ queryCache: new QueryCache({ onSuccess }) })
    const utils = createRouterUtils(client, { plugins: [new StreamQuerySSRUtilsPlugin({ isServer: true })] })

    await expect(queryClient.fetchQuery(utils.stream.liveOptions())).resolves.toBe(1)

    expect(queryClient.getQueryState(utils.stream.liveKey())).toMatchObject({ status: 'success', fetchStatus: 'idle', data: 1 })
    expect(onSuccess).not.toHaveBeenCalled()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(vi.mocked(client.stream).mock.calls[0]![1]!.signal!.aborted).toBe(true)
  })

  it('cancels streamed queries once they connect on the server', async () => {
    const onSuccess = vi.fn()
    const queryClient = new QueryClient({ queryCache: new QueryCache({ onSuccess }) })
    const utils = createRouterUtils(client, { plugins: [new StreamQuerySSRUtilsPlugin({ isServer: true })] })

    await expect(queryClient.fetchQuery(utils.stream.streamedOptions())).resolves.toEqual([])

    expect(queryClient.getQueryState(utils.stream.streamedKey())).toMatchObject({ status: 'success', fetchStatus: 'idle', data: [] })
    expect(onSuccess).not.toHaveBeenCalled()
    await expect(vi.mocked(client.stream).mock.results[0]!.value.next()).resolves.toEqual({ done: true, value: undefined })
    expect(vi.mocked(client.stream).mock.calls[0]![1]!.signal!.aborted).toBe(true)
  })

  it('forwards query cancellation to the call on the server', async () => {
    const queryClient = new QueryClient()
    const pendingClient = {
      stream: vi.fn(async function* (_input, { signal }) {
        await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
      }),
    } as unknown as typeof client
    const utils = createRouterUtils(pendingClient, { plugins: [new StreamQuerySSRUtilsPlugin({ isServer: true })] })

    void queryClient.prefetchQuery(utils.stream.liveOptions())
    await vi.waitFor(() => expect(pendingClient.stream).toHaveBeenCalledTimes(1))

    const signal = vi.mocked(pendingClient.stream).mock.calls[0]![1]!.signal!
    expect(signal.aborted).toBe(false)

    await queryClient.cancelQueries()
    expect(signal.aborted).toBe(true)
  })

  it('cancels the query before closing the stream on the server', async () => {
    const queryClient = new QueryClient()
    const signalClient = {
      stream: vi.fn(async function* (_input, { signal }) {
        const aborted = new Promise(resolve => signal.addEventListener('abort', resolve))

        try {
          yield 1
        }
        finally {
          await aborted
        }
      }),
    } as unknown as typeof client
    const utils = createRouterUtils(signalClient, { plugins: [new StreamQuerySSRUtilsPlugin({ isServer: true })] })

    await queryClient.prefetchQuery(utils.stream.liveOptions())

    expect(queryClient.getQueryState(utils.stream.liveKey())).toMatchObject({ status: 'success', fetchStatus: 'idle', data: 1 })
  })

  it('settles live queries whose stream ends before the first event on the server', async () => {
    const queryClient = new QueryClient()
    const emptyClient = { stream: vi.fn(async function* () {}) } as unknown as typeof client
    const utils = createRouterUtils(emptyClient, { plugins: [new StreamQuerySSRUtilsPlugin({ isServer: true })] })

    await expect(queryClient.fetchQuery(utils.stream.liveOptions())).rejects.toThrow('did not yield any data')
  })

  it('follows streams in the browser', async () => {
    const queryClient = new QueryClient()
    const utils = createRouterUtils(client, { plugins: [new StreamQuerySSRUtilsPlugin({ isServer: false })] })

    void queryClient.prefetchQuery(utils.stream.liveOptions())

    await vi.waitFor(() => expect(queryClient.getQueryData(utils.stream.liveKey())).toBe(2))
    expect(vi.mocked(client.stream).mock.calls[0]![1]!.signal!.aborted).toBe(false)
    await queryClient.cancelQueries()
  })

  it('detects the server by the absence of window', () => {
    expect(new StreamQuerySSRUtilsPlugin().initProcedureOptions([], {})).toMatchObject({ cancelStreamsOnFirstData: true })

    vi.stubGlobal('window', {})
    expect(new StreamQuerySSRUtilsPlugin().initProcedureOptions([], {})).toMatchObject({ cancelStreamsOnFirstData: false })
  })

  it('refetches streamed and live queries on mount', () => {
    const utils = createRouterUtils(client, { plugins: [new StreamQuerySSRUtilsPlugin()] })

    expect(utils.stream.streamedOptions()).toMatchObject({ initialData: [], refetchOnMount: 'always' })
    expect(utils.stream.liveOptions()).toMatchObject({ refetchOnMount: 'always' })
    expect(utils.stream.liveOptions()).not.toHaveProperty('initialData')
    expect(utils.stream.queryOptions()).not.toHaveProperty('refetchOnMount')
  })

  it('lets utils and call options override its defaults', () => {
    const utils = createRouterUtils(client, {
      plugins: [new StreamQuerySSRUtilsPlugin()],
      scoped: {
        stream: {
          streamedOptions: options => ({ ...options, refetchOnMount: false }),
        },
      },
    })

    expect(utils.stream.streamedOptions()).toMatchObject({ initialData: [], refetchOnMount: false })
    expect(utils.stream.liveOptions({ refetchOnMount: true })).toMatchObject({ refetchOnMount: true })
  })
})
