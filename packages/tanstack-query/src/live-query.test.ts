import { sleep } from '@orpc/shared'
import { QueryClient, QueryObserver } from '@tanstack/query-core'

import { liveQuery } from './live-query.ts'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

beforeEach(() => {
  queryClient.clear()
})

describe('liveQuery', async () => {
  it('works', async () => {
    const queryFn = liveQuery(async function* () {
      yield 1
      await sleep(50)
      yield 2
      await sleep(50)
      yield 3
    })

    const controller = new AbortController()

    const resultPromise = expect(
      queryFn({
        queryKey: ['live-query'],
        signal: controller.signal,
        client: queryClient,
      } as any),
    ).resolves.toEqual(3)

    await vi.waitFor(() => {
      expect(queryClient.getQueryData(['live-query'])).toEqual(1)
    })

    await vi.waitFor(() => {
      expect(queryClient.getQueryData(['live-query'])).toEqual(2)
    })

    await resultPromise
  })

  it('keeps data written after the last event', async () => {
    const queryFn = liveQuery(async function* () {
      yield 1
      queryClient.setQueryData(['live-query'], 2)
    })

    await expect(
      queryFn({
        queryKey: ['live-query'],
        signal: new AbortController().signal,
        client: queryClient,
      } as any),
    ).resolves.toEqual(2)
  })

  it('keeps null written after the last event', async () => {
    const queryFn = liveQuery(async function* () {
      yield 1
      queryClient.setQueryData(['live-query'], null)
    })

    await expect(
      queryFn({
        queryKey: ['live-query'],
        signal: new AbortController().signal,
        client: queryClient,
      } as any),
    ).resolves.toBeNull()
  })

  it('on abort signal', async () => {
    let cleanupCalled = false

    const queryFn = liveQuery(async function* () {
      try {
        yield 1
        await sleep(50)
        yield 2
        await sleep(50)
        yield 3
      } finally {
        cleanupCalled = true
      }
    })

    const controller = new AbortController()

    const resultPromise = expect(
      queryFn({
        queryKey: ['live-query'],
        signal: controller.signal,
        client: queryClient,
      } as any),
    ).rejects.toSatisfy((err) => err === controller.signal.reason)

    await vi.waitFor(() => {
      expect(queryClient.getQueryData(['live-query'])).toEqual(1)
    })

    controller.abort()

    await resultPromise
    expect(cleanupCalled).toBe(true)
  })

  it('throw if no data yielded', async () => {
    const queryFn = liveQuery(async function* () {})

    await expect(
      queryFn({
        queryKey: ['live-query'],
        signal: new AbortController().signal,
        client: queryClient,
      } as any),
    ).rejects.toThrow(
      'Live query for ["live-query"] did not yield any data. Ensure the query function returns an AsyncIterable with at least one chunk.',
    )
  })

  it('rejects on an undefined event, which TanStack Query cannot store', async () => {
    const queryFn = liveQuery(async function* () {
      yield undefined
    })

    await expect(
      queryFn({
        queryKey: ['live-query'],
        signal: new AbortController().signal,
        client: queryClient,
      } as any),
    ).rejects.toEqual(
      new TypeError(
        'Live query for ["live-query"] yielded `undefined`, which TanStack Query cannot store.',
      ),
    )
  })

  it("writes to the fetch's own query with a custom queryKeyHashFn", async () => {
    await expect(
      queryClient.fetchQuery({
        queryKey: ['live-query'],
        queryKeyHashFn: () => 'custom',
        queryFn: liveQuery(
          async function* () {
            yield 1
            yield 2
          },
          { settleOnFirstData: true },
        ),
      }),
    ).resolves.toBe(1)

    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryHash),
    ).toEqual(['custom'])
  })

  it('keeps existing data until the first event', async () => {
    const key = ['live-query']
    queryClient.setQueryData(key, 0)
    const statuses: string[] = []
    onTestFinished(
      queryClient.getQueryCache().subscribe(({ query }) => statuses.push(query.state.status)),
    )

    const promise = queryClient.fetchQuery({
      queryKey: key,
      queryFn: liveQuery(async function* () {
        await sleep(50)
        yield 1
      }),
    })

    expect(queryClient.getQueryState(key)).toMatchObject({
      status: 'success',
      fetchStatus: 'fetching',
      data: 0,
    })
    await expect(promise).resolves.toBe(1)
    expect(statuses).not.toContain('pending')
  })

  it('settles on the first event marked stale when settleOnFirstData is true', async () => {
    const key = ['live-query']
    const cleanup = vi.fn()

    await expect(
      queryClient.fetchQuery({
        queryKey: key,
        queryFn: liveQuery(
          async function* () {
            try {
              yield 1
              await new Promise(() => {})
            } finally {
              cleanup()
            }
          },
          { settleOnFirstData: true },
        ),
      }),
    ).resolves.toBe(1)

    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1))
    expect(queryClient.getQueryState(key)).toMatchObject({
      status: 'success',
      fetchStatus: 'idle',
      data: 1,
      isInvalidated: true,
    })
  })
})
