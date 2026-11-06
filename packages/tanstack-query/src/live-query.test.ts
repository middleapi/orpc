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

  it('closes the stream without starting it and marks the query stale when aborted before it connects', async () => {
    const key = ['live-abort-before-connect']
    queryClient.setQueryData(key, 0)
    const controller = new AbortController()
    const started = vi.fn()
    const queryFn = liveQuery(async () => {
      controller.abort()
      return (async function* () {
        started()
        yield 1
      })()
    })

    await expect(
      queryFn({ queryKey: key, signal: controller.signal, client: queryClient } as any),
    ).rejects.toBe(controller.signal.reason)
    expect(started).not.toHaveBeenCalled()
    expect(queryClient.getQueryState(key)).toMatchObject({ data: 0, isInvalidated: true })
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

  it('settles on the first event and closes the stream when settleOnFirstData is true', async () => {
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
    })
  })
})
