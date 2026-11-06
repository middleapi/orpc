import { promiseWithResolvers } from '@orpc/shared'
import { effectScope, watch } from 'vue'

import { createChunkController, createQueryCache, mountQuery } from '../tests/__shared__/utils.ts'
import { serializableStreamedQuery } from './stream-query.ts'

describe('serializableStreamedQuery', () => {
  it('publishes each chunk to the cache as it arrives on first fetch', async () => {
    const controller = createChunkController<number>()
    const mounted = mountQuery({
      key: ['stream'],
      query: serializableStreamedQuery(() => controller.stream()),
    })

    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual([]), { interval: 1 })
    expect(mounted.vm.query.asyncStatus.value).toEqual('loading')

    controller.push(1)
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual([1]), { interval: 1 })
    expect(mounted.vm.query.asyncStatus.value).toEqual('loading')

    controller.push(2)
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual([1, 2]), { interval: 1 })

    controller.close()
    await vi.waitFor(() => expect(mounted.vm.query.asyncStatus.value).toEqual('idle'), {
      interval: 1,
    })
    expect(mounted.vm.query.data.value).toEqual([1, 2])
    expect(mounted.vm.query.status.value).toEqual('success')
    expect(mounted.vm.queryCache.getQueryData(['stream'])).toEqual([1, 2])
  })

  it('keeps previous data until connect, then resets to [] by default on refetch', async () => {
    const first = createChunkController<string>()
    const second = createChunkController<string>()
    const secondReady = promiseWithResolvers<void>()

    const queryFn = vi
      .fn()
      .mockImplementationOnce(() => first.stream())
      .mockImplementationOnce(async () => {
        await secondReady.promise
        return second.stream()
      })

    const mounted = mountQuery({
      key: ['stream'],
      query: serializableStreamedQuery(queryFn),
    })

    first.push('old')
    first.close()
    await vi.waitFor(() => expect(mounted.vm.query.asyncStatus.value).toEqual('idle'), {
      interval: 1,
    })
    expect(mounted.vm.query.data.value).toEqual(['old'])

    const statuses: string[] = []
    watch(
      () => mounted.vm.query.status.value,
      (status) => statuses.push(status),
      { flush: 'sync' },
    )

    const refetching = mounted.vm.query.refetch()

    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2), { interval: 1 })
    expect(mounted.vm.query.data.value).toEqual(['old'])
    expect(mounted.vm.query.status.value).toEqual('success')
    expect(mounted.vm.query.asyncStatus.value).toEqual('loading')

    secondReady.resolve()
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual([]), { interval: 1 })

    second.push('a')
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(['a']), { interval: 1 })
    expect(mounted.vm.query.asyncStatus.value).toEqual('loading')

    second.close()
    await refetching
    expect(mounted.vm.query.data.value).toEqual(['a'])
    expect(mounted.vm.query.asyncStatus.value).toEqual('idle')
    expect(statuses).not.toContain('pending')
  })

  it('appends to previous data with refetchMode=append', async () => {
    const first = createChunkController<string>()
    const second = createChunkController<string>()

    const queryFn = vi
      .fn()
      .mockImplementationOnce(() => first.stream())
      .mockImplementationOnce(() => second.stream())

    const mounted = mountQuery({
      key: ['stream'],
      query: serializableStreamedQuery(queryFn, { refetchMode: 'append' }),
    })

    first.push('old')
    first.close()
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(['old']), { interval: 1 })

    const refetching = mounted.vm.query.refetch()

    second.push('a')
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(['old', 'a']), {
      interval: 1,
    })
    expect(mounted.vm.query.asyncStatus.value).toEqual('loading')

    second.close()
    await refetching
    expect(mounted.vm.query.data.value).toEqual(['old', 'a'])
  })

  it('trims previous data to maxChunks at connect with refetchMode=append', async () => {
    const first = createChunkController<string>()
    const second = createChunkController<string>()
    const secondReady = promiseWithResolvers<void>()

    const queryFn = vi
      .fn()
      .mockImplementationOnce(() => first.stream())
      .mockImplementationOnce(async () => {
        await secondReady.promise
        return second.stream()
      })

    const mounted = mountQuery({
      key: ['stream'],
      query: serializableStreamedQuery(queryFn, { refetchMode: 'append', maxChunks: 2 }),
    })

    first.push('old1')
    first.push('old2')
    first.push('old3')
    first.close()
    await vi.waitFor(() => expect(mounted.vm.query.asyncStatus.value).toEqual('idle'), {
      interval: 1,
    })
    expect(mounted.vm.query.data.value).toEqual(['old2', 'old3'])

    mounted.vm.queryCache.setQueryData(['stream'], ['old1', 'old2', 'old3'])
    const refetching = mounted.vm.query.refetch()

    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2), { interval: 1 })
    expect(mounted.vm.query.data.value).toEqual(['old1', 'old2', 'old3'])

    secondReady.resolve()
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(['old2', 'old3']), {
      interval: 1,
    })

    second.push('a')
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(['old3', 'a']), {
      interval: 1,
    })

    second.close()
    await refetching
  })

  it('keeps data written to the entry during the stream and after the last chunk', async () => {
    const controller = createChunkController<string>()
    const mounted = mountQuery({
      key: ['stream'],
      query: serializableStreamedQuery(() => controller.stream()),
    })

    controller.push('a')
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(['a']), { interval: 1 })

    mounted.vm.queryCache.setQueryData(['stream'], ['during'])

    controller.push('b')
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(['during', 'b']), {
      interval: 1,
    })

    mounted.vm.queryCache.setQueryData(['stream'], ['during', 'b', 'after'])

    controller.close()
    await vi.waitFor(() => expect(mounted.vm.query.asyncStatus.value).toEqual('idle'), {
      interval: 1,
    })
    expect(mounted.vm.query.data.value).toEqual(['during', 'b', 'after'])
    expect(mounted.vm.query.status.value).toEqual('success')
  })

  it('limits chunks with maxChunks', async () => {
    const first = createChunkController<string>()
    const second = createChunkController<string>()

    const queryFn = vi
      .fn()
      .mockImplementationOnce(() => first.stream())
      .mockImplementationOnce(() => second.stream())

    const mounted = mountQuery({
      key: ['stream'],
      query: serializableStreamedQuery(queryFn, { refetchMode: 'append', maxChunks: 2 }),
    })

    first.push('old1')
    first.push('old2')
    first.close()
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(['old1', 'old2']), {
      interval: 1,
    })

    const refetching = mounted.vm.query.refetch()

    second.push('a')
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(['old2', 'a']), {
      interval: 1,
    })

    second.push('b')
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(['a', 'b']), { interval: 1 })

    second.close()
    await refetching
    expect(mounted.vm.query.data.value).toEqual(['a', 'b'])
  })

  it('does not let a superseded fetch overwrite newer data', async () => {
    const firstReady = promiseWithResolvers<void>()
    const firstStarted = vi.fn()
    const firstStream = (async function* () {
      firstStarted()
      yield 'stale'
    })()
    const firstClosed = vi.spyOn(firstStream, 'return')
    const second = createChunkController<string>()

    const queryFn = vi
      .fn()
      .mockImplementationOnce(async () => {
        await firstReady.promise
        return firstStream
      })
      .mockImplementationOnce(() => second.stream())

    const mounted = mountQuery({
      key: ['stream'],
      query: serializableStreamedQuery(queryFn),
    })

    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1), { interval: 1 })
    const refetching = mounted.vm.query.refetch()

    second.push('new')
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(['new']), { interval: 1 })

    firstReady.resolve()
    await vi.waitFor(() => expect(firstClosed).toHaveBeenCalled(), { interval: 1 })
    expect(firstStarted).not.toHaveBeenCalled()
    expect(mounted.vm.query.data.value).toEqual(['new'])

    second.close()
    await refetching
  })

  it('stops streaming when the query is cancelled', async () => {
    const controller = createChunkController<string>()
    const mounted = mountQuery({
      key: ['stream'],
      query: serializableStreamedQuery(() => controller.stream()),
    })

    controller.push('a')
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(['a']), { interval: 1 })

    mounted.vm.queryCache.cancelQueries({ key: ['stream'] }, new Error('__cancelled__'))
    controller.push('b') // resumes the stream loop, which now observes the aborted signal

    await vi.waitFor(() => expect(mounted.vm.query.asyncStatus.value).toEqual('idle'), {
      interval: 1,
    })
    expect(mounted.vm.query.data.value).toEqual(['a'])
    expect(mounted.vm.query.error.value).toBeNull()
  })

  it('closes the stream when the last component unmounts before it connects', async () => {
    const ready = promiseWithResolvers<void>()
    const started = vi.fn()
    const stream = (async function* () {
      started()
      yield 'new'
    })()
    const closed = vi.spyOn(stream, 'return')
    let signal: AbortSignal | undefined

    const queryFn = vi
      .fn()
      .mockImplementationOnce(async () =>
        (async function* () {
          yield 'old'
        })(),
      )
      .mockImplementationOnce(async (context) => {
        signal = context.signal
        await ready.promise
        return stream
      })

    const mounted = mountQuery({
      key: ['stream'],
      query: serializableStreamedQuery(queryFn),
    })
    const queryCache = mounted.vm.queryCache

    await vi.waitFor(() => expect(mounted.vm.query.asyncStatus.value).toEqual('idle'), {
      interval: 1,
    })
    void mounted.vm.query.refetch()
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2), { interval: 1 })

    mounted.unmount()
    ready.resolve()

    await vi.waitFor(() => expect(closed).toHaveBeenCalled(), { interval: 1 })
    expect(signal?.aborted).toBe(true)
    expect(started).not.toHaveBeenCalled()
    expect(queryCache.getQueryData(['stream'])).toEqual(['old'])
  })

  it('closes the stream once the last component unmounts mid-stream', async () => {
    const controller = createChunkController<number>()
    const cleanup = vi.fn()
    let signal: AbortSignal | undefined

    const mounted = mountQuery({
      key: ['stream'],
      query: serializableStreamedQuery(async (context) => {
        signal = context.signal
        return (async function* () {
          try {
            yield* controller.stream()
          } finally {
            cleanup()
          }
        })()
      }),
    })
    const queryCache = mounted.vm.queryCache

    controller.push(1)
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual([1]), { interval: 1 })

    mounted.unmount()
    controller.push(2)

    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1), { interval: 1 })
    expect(signal?.aborted).toBe(true)
    expect(queryCache.getQueryData(['stream'])).toEqual([1])
  })

  it('marks an entry stale when its refetch is aborted because the last component unmounted', async () => {
    const controller = createChunkController<number>()
    const signals: AbortSignal[] = []

    const mounted = mountQuery({
      key: ['stream'],
      staleTime: 60_000,
      query: serializableStreamedQuery(async ({ signal }) => {
        signals.push(signal)
        return signals.length === 1
          ? (async function* () {
              yield 1
            })()
          : controller.stream()
      }),
    })
    const queryCache = mounted.vm.queryCache
    const entry = () => queryCache.getEntries({ key: ['stream'], exact: true })[0]!

    await vi.waitFor(
      () => expect(entry().state.value).toMatchObject({ status: 'success', data: [1] }),
      { interval: 1 },
    )
    await vi.waitFor(() => expect(entry().pending).toBeNull(), { interval: 1 })
    expect(entry().stale).toBe(false)

    void mounted.vm.query.refetch()
    controller.push(2)
    await vi.waitFor(() => expect(entry().state.value.data).toEqual([2]), { interval: 1 })

    mounted.unmount()
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.push(3)

    await vi.waitFor(() => expect(signals[1]!.aborted).toBe(true), { interval: 1 })
    expect(entry().stale).toBe(true)
    expect(entry().state.value.data).toEqual([2])
  })

  it('follows the stream of a fetch no component ever used', async () => {
    const controller = createChunkController<number>()
    const queryCache = createQueryCache()
    queryCache.setQueryData(['stream'], [0])

    const entry = queryCache.ensure({
      key: ['stream'],
      query: serializableStreamedQuery(() => controller.stream()),
    })
    const fetching = queryCache.fetch(entry)

    controller.push(1)
    controller.push(2)
    controller.close()

    await expect(fetching).resolves.toEqual({ status: 'success', data: [1, 2], error: null })
  })

  it('settles a fetch with no component at connect with settleOnFirstData: true', async () => {
    const started = vi.fn()
    const queryCache = createQueryCache()
    queryCache.setQueryData(['stream'], ['old'])

    const entry = queryCache.ensure({
      key: ['stream'],
      query: serializableStreamedQuery(
        async () =>
          (async function* () {
            started()
            yield 'a'
          })(),
        { settleOnFirstData: true },
      ),
    })

    await expect(queryCache.fetch(entry)).resolves.toEqual({
      status: 'success',
      data: [],
      error: null,
    })
    expect(started).not.toHaveBeenCalled()
    expect(entry.asyncStatus.value).toEqual('idle')
  })

  it('settles a mounted useQuery with settleOnFirstData: true', async () => {
    const controller = createChunkController<number>()
    const mounted = mountQuery({
      key: ['stream'],
      query: serializableStreamedQuery(() => controller.stream(), { settleOnFirstData: true }),
    })

    await vi.waitFor(() => expect(mounted.vm.query.asyncStatus.value).toEqual('idle'), {
      interval: 1,
    })
    expect(mounted.vm.query.data.value).toEqual([])
    expect(mounted.vm.query.status.value).toEqual('success')
  })

  it('does not write unchanged data at connect (append)', async () => {
    const queryCache = createQueryCache()
    queryCache.setQueryData(['stream'], ['old'])
    const entry = queryCache.ensure({
      key: ['stream'],
      query: serializableStreamedQuery(
        async () =>
          (async function* () {
            yield 'a'
          })(),
        { refetchMode: 'append', settleOnFirstData: true },
      ),
    })
    const writes = vi.fn()
    const stop = watch(entry.state, writes, { flush: 'sync' })

    await expect(queryCache.fetch(entry)).resolves.toEqual({
      status: 'success',
      data: ['old'],
      error: null,
    })
    // only Colada's own write once the fetch resolves
    expect(writes).toHaveBeenCalledTimes(1)
    stop()
  })
})
