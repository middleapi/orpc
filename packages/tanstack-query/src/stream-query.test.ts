import { promiseWithResolvers, sleep } from '@orpc/shared'
import type { QueryKey, QueryState } from '@tanstack/query-core'
import {
  dehydrate,
  hashKey,
  hydrate,
  QueryCache,
  QueryClient,
  QueryObserver,
} from '@tanstack/query-core'

import { distinctData } from '../tests/__shared__/utils.ts'
import { serializableStreamedQuery } from './stream-query.ts'

describe('serializableStreamedQuery', () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  beforeEach(() => {
    queryClient.clear()
  })

  function stream<T>(chunks: T[], delay = 10) {
    return async () => {
      await sleep(delay)
      return (async function* () {
        for (const chunk of chunks) {
          await sleep(delay)
          yield chunk
        }
      })()
    }
  }

  function recordStates(key: QueryKey, client = queryClient) {
    const states: Pick<QueryState, 'status' | 'fetchStatus' | 'data'>[] = []
    const unsubscribe = client.getQueryCache().subscribe(({ query }) => {
      if (query.queryHash === hashKey(key)) {
        const { status, fetchStatus, data } = query.state
        states.push({ status, fetchStatus, data })
      }
    })
    onTestFinished(unsubscribe)
    return states
  }

  describe('refetchMode option', () => {
    const origins: Record<string, (key: QueryKey) => Promise<{ initialData?: string[] }>> = {
      'initialData': async () => ({ initialData: ['x1', 'x2'] }),
      'setQueryData': async (key) => {
        queryClient.setQueryData(key, ['x1', 'x2'])
        return {}
      },
      'a previous fetch': async (key) => {
        await queryClient.fetchQuery({
          queryKey: key,
          queryFn: serializableStreamedQuery(stream(['x1', 'x2'])),
        })
        return {}
      },
      'hydrate': async (key) => {
        const server = new QueryClient()
        server.setQueryData(key, ['x1', 'x2'])
        hydrate(queryClient, dehydrate(server))
        return {}
      },
    }

    it.each(
      Object.keys(origins).flatMap(
        (origin) =>
          [
            [origin, 'reset', [['x1', 'x2'], [], ['c1'], ['c1', 'c2']]],
            [
              origin,
              'append',
              [
                ['x1', 'x2'],
                ['x1', 'x2', 'c1'],
                ['x1', 'x2', 'c1', 'c2'],
              ],
            ],
          ] as const,
      ),
    )(
      'keeps data from %s until the stream connects, never pending (%s)',
      async (origin, refetchMode, expected) => {
        const key = ['refetch-test', origin, refetchMode]
        const options = await origins[origin]!(key)
        const states = recordStates(key)

        await expect(
          queryClient.fetchQuery({
            queryKey: key,
            queryFn: serializableStreamedQuery(stream(['c1', 'c2']), { refetchMode }),
            ...options,
          }),
        ).resolves.toEqual(expected.at(-1))

        expect(distinctData(states)).toEqual(expected)
        expect(states.map((state) => state.status)).not.toContain('pending')
        expect(states.find((state) => state.fetchStatus === 'fetching')).toEqual({
          status: 'success',
          fetchStatus: 'fetching',
          data: ['x1', 'x2'],
        })
        expect(states.at(-1)).toMatchObject({ status: 'success', fetchStatus: 'idle' })
      },
    )
  })

  describe('maxChunks option', () => {
    it.each([
      [
        'append',
        [
          ['pre5', 'pre6'],
          ['pre6', 'chunk1'],
        ],
      ],
      ['reset', [[], ['chunk1']]],
    ] as const)(
      'works with %s & parallel',
      async (refetchMode, [afterConnect, afterFirstChunk]) => {
        const key = ['max-chunks-test']
        const queryFn = serializableStreamedQuery(
          async () => {
            await sleep(50)

            return (async function* () {
              await sleep(50)
              yield 'chunk1'
              await sleep(50)
              yield 'chunk2'
              await sleep(50)
              yield 'chunk3'
              await sleep(50)
              yield 'chunk4'
              await sleep(50)
            })()
          },
          { maxChunks: 2, refetchMode },
        )

        queryClient.setQueryData(key, ['pre1', 'pre2', 'pre3'])

        const resultPromise = expect(
          queryFn({
            queryKey: key,
            signal: new AbortController().signal,
            client: queryClient,
          } as any),
        ).resolves.toEqual(['parallel5', 'parallel6'])

        await sleep(0)
        expect(queryClient.getQueryData(key)).toEqual(['pre1', 'pre2', 'pre3'])

        queryClient.setQueryData(key, ['pre4', 'pre5', 'pre6'])
        await sleep(50)
        expect(queryClient.getQueryData(key)).toEqual(afterConnect)

        await sleep(50)
        expect(queryClient.getQueryData(key)).toEqual(afterFirstChunk)

        await sleep(50)
        expect(queryClient.getQueryData(key)).toEqual(['chunk1', 'chunk2'])

        await sleep(50)
        expect(queryClient.getQueryData(key)).toEqual(['chunk2', 'chunk3'])

        queryClient.setQueryData(key, ['parallel1', 'parallel2', 'parallel3'])

        await sleep(50)
        expect(queryClient.getQueryData(key)).toEqual(['parallel3', 'chunk4'])

        queryClient.setQueryData(key, ['parallel4', 'parallel5', 'parallel6'])

        await resultPromise
      },
    )
  })

  describe('abort signal handling', () => {
    it('marks the query stale when aborted before the stream connects', async () => {
      const key = ['abort-before-connect']
      queryClient.setQueryData(key, ['old'])
      const controller = new AbortController()
      const queryFn = serializableStreamedQuery(async () => {
        controller.abort()
        return stream(['new'])()
      })

      await expect(
        queryFn({ queryKey: key, signal: controller.signal, client: queryClient } as any),
      ).rejects.toBe(controller.signal.reason)
      expect(queryClient.getQueryState(key)).toMatchObject({ data: ['old'], isInvalidated: true })
    })

    it('does not mark a replacing fetch stale when the cancelled stream notices the abort late', async () => {
      const key = ['superseded-test']
      const connect = vi.fn(async () =>
        connect.mock.calls.length > 1
          ? (async function* () {
              yield 'new'
            })()
          : // ignores the abort until its next chunk
            (async function* () {
              yield 'old1'
              await sleep(50)
              yield 'old2'
            })(),
      )
      const observer = new QueryObserver(queryClient, {
        queryKey: key,
        queryFn: serializableStreamedQuery(connect),
        staleTime: Number.POSITIVE_INFINITY,
      })
      onTestFinished(observer.subscribe(() => {}))
      await vi.waitFor(() => expect(queryClient.getQueryData(key)).toEqual(['old1']))

      await observer.refetch()
      expect(queryClient.getQueryState(key)).toMatchObject({ data: ['new'], isInvalidated: false })

      await sleep(80)
      expect(queryClient.getQueryState(key)).toMatchObject({ data: ['new'], isInvalidated: false })
    })

    it('handles abort signal during streaming', async () => {
      let cleanupCalled = false
      const yieldFn = vi.fn((v) => v)
      const queryFn = serializableStreamedQuery(async function* () {
        try {
          yield yieldFn('chunk1')
          await sleep(50)
          yield yieldFn('chunk2')
          await sleep(50)
          yield yieldFn('chunk3')
        } finally {
          cleanupCalled = true
        }
      })

      const controller = new AbortController()

      const resultPromise = expect(
        queryFn({
          queryKey: ['abort-test'],
          signal: controller.signal,
          client: queryClient,
        } as any),
      ).rejects.toSatisfy((err) => err === controller.signal.reason)

      await vi.waitFor(() => {
        expect(queryClient.getQueryData(['abort-test'])).toEqual(['chunk1'])
      })

      controller.abort()

      await resultPromise
      expect(cleanupCalled).toBe(true)
      expect(yieldFn).toHaveBeenCalledTimes(2)
      expect(queryClient.getQueryData(['abort-test'])).toEqual(['chunk1'])
    })

    it('does not write or start the stream when aborted before it connects', async () => {
      const key = ['abort-before-connect-test']
      queryClient.setQueryData(key, ['x'])
      const started = vi.fn()
      const controller = new AbortController()

      await expect(
        serializableStreamedQuery(async () => {
          controller.abort()
          return (async function* () {
            started()
            yield 'chunk1'
          })()
        })({
          queryKey: key,
          signal: controller.signal,
          client: queryClient,
        } as any),
      ).rejects.toSatisfy((err) => err === controller.signal.reason)

      expect(started).not.toHaveBeenCalled()
      expect(queryClient.getQueryState(key)).toMatchObject({ data: ['x'], dataUpdateCount: 1 })
    })

    it('keeps the chunks received before cancelQueries and writes no more', async () => {
      const key = ['cancel-test']
      const cleanup = vi.fn()
      const gate = promiseWithResolvers<void>()
      const promise = queryClient.fetchQuery({
        queryKey: key,
        queryFn: serializableStreamedQuery(async function* () {
          try {
            yield 'c1'
            await gate.promise
            yield 'c2'
          } finally {
            cleanup()
          }
        }),
      })

      await vi.waitFor(() => expect(queryClient.getQueryData(key)).toEqual(['c1']))
      await queryClient.cancelQueries({ queryKey: key })
      await expect(promise).resolves.toEqual(['c1'])

      gate.resolve()
      await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1))
      expect(queryClient.getQueryState(key)).toMatchObject({
        status: 'success',
        fetchStatus: 'idle',
        data: ['c1'],
      })
    })
  })

  describe('edge cases', () => {
    it('handle cache is reset while ending stream', async () => {
      const key = ['data-reset-test']

      const queryFn = serializableStreamedQuery(async function* () {
        yield 'chunk1'
        await sleep(100)
      })

      const promise1 = expect(
        queryFn({
          queryKey: key,
          signal: new AbortController().signal,
          client: queryClient,
        } as any),
      ).resolves.toEqual(['chunk1'])

      await sleep(0)
      expect(queryClient.getQueryData(key)).toEqual(['chunk1'])

      void queryClient.resetQueries({ queryKey: key, exact: true })

      await promise1
    })

    it('handles error in stream', async () => {
      const queryFn = serializableStreamedQuery(async function* () {
        yield 'chunk1'
        await sleep(50)
        throw new Error('Stream error')
      })

      await expect(
        queryFn({
          queryKey: ['error-stream'],
          signal: new AbortController().signal,
          client: queryClient,
        } as any),
      ).rejects.toThrow('Stream error')

      expect(queryClient.getQueryData(['error-stream'])).toEqual(['chunk1'])
    })
  })

  describe('settleOnFirstData option', () => {
    it.each([
      ['reset', []],
      ['append', ['x2', 'x3']],
    ] as const)(
      'settles at connect without starting the stream when true (%s)',
      async (refetchMode, expected) => {
        const onSuccess = vi.fn()
        const client = new QueryClient({ queryCache: new QueryCache({ onSuccess }) })
        const key = ['settle-test']
        client.setQueryData(key, ['x1', 'x2', 'x3'])
        const started = vi.fn()

        await expect(
          client.fetchQuery({
            queryKey: key,
            queryFn: serializableStreamedQuery(
              async () => {
                return (async function* () {
                  started()
                  yield 'c1'
                })()
              },
              { refetchMode, maxChunks: 2, settleOnFirstData: true },
            ),
          }),
        ).resolves.toEqual(expected)

        expect(client.getQueryState(key)).toMatchObject({
          status: 'success',
          fetchStatus: 'idle',
          data: expected,
        })
        expect(started).not.toHaveBeenCalled()
        expect(onSuccess).toHaveBeenCalledTimes(1)
      },
    )
  })
})
