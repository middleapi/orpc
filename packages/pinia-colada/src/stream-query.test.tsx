import type { UseQueryOptions } from '@pinia/colada'
import { defineQuery, PiniaColada, useQuery, useQueryCache } from '@pinia/colada'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { serializableStreamedQuery } from './stream-query'

/**
 * Mounts a component that runs a real Pinia Colada `useQuery`,
 * so tests can observe exactly what users see.
 */
function mountQuery(options: UseQueryOptions<any, any, any>) {
  return mount(defineComponent({
    setup() {
      const queryCache = useQueryCache()
      const query = useQuery(options)

      return { query, queryCache }
    },
    render: () => null,
  }), {
    global: {
      plugins: [
        createPinia(),
        PiniaColada,
      ],
    },
  })
}

/**
 * An AsyncIterable whose chunks are pushed manually, so tests can assert
 * intermediate states deterministically while the stream is still open.
 */
function createChunkController<T>() {
  const buffer: ({ value: T } | { done: true })[] = []
  let notify: (() => void) | undefined

  return {
    async* stream() {
      while (true) {
        while (buffer.length === 0) {
          await new Promise<void>((resolve) => {
            notify = resolve
          })
        }

        const item = buffer.shift()!

        if ('done' in item) {
          return
        }

        yield item.value
      }
    },
    push(value: T) {
      buffer.push({ value })
      notify?.()
    },
    close() {
      buffer.push({ done: true })
      notify?.()
    },
  }
}

describe('serializableStreamedQuery', () => {
  it('publishes each chunk to the cache as it arrives on first fetch', async () => {
    const controller = createChunkController<number>()
    const mounted = mountQuery({
      key: ['stream'],
      query: serializableStreamedQuery(() => controller.stream()),
    })

    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual([]))
    expect(mounted.vm.query.asyncStatus.value).toEqual('loading')

    controller.push(1)
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual([1]))
    expect(mounted.vm.query.asyncStatus.value).toEqual('loading')

    controller.push(2)
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual([1, 2]))

    controller.close()
    await vi.waitFor(() => expect(mounted.vm.query.asyncStatus.value).toEqual('idle'))
    expect(mounted.vm.query.data.value).toEqual([1, 2])
    expect(mounted.vm.query.status.value).toEqual('success')
    expect(mounted.vm.queryCache.getQueryData(['stream'])).toEqual([1, 2])
  })

  it('resets previous data to pending by default on refetch', async () => {
    const first = createChunkController<string>()
    const second = createChunkController<string>()

    let releaseSecond!: () => void
    const secondReady = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })

    const queryFn = vi.fn()
      .mockImplementationOnce(() => first.stream())
      .mockImplementationOnce(async () => {
        await secondReady
        return second.stream()
      })

    const mounted = mountQuery({
      key: ['stream'],
      query: serializableStreamedQuery(queryFn),
    })

    first.push('old')
    first.close()
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(['old']))

    const refetching = mounted.vm.query.refetch()

    // previous data is cleared and the query goes back to pending
    await vi.waitFor(() => expect(mounted.vm.query.status.value).toEqual('pending'))
    expect(mounted.vm.query.data.value).toBeUndefined()

    releaseSecond()
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual([]))

    second.push('a')
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(['a']))
    expect(mounted.vm.query.asyncStatus.value).toEqual('loading')

    second.close()
    await refetching
    expect(mounted.vm.query.data.value).toEqual(['a'])
    expect(mounted.vm.query.asyncStatus.value).toEqual('idle')
  })

  it('appends to previous data with refetchMode=append', async () => {
    const first = createChunkController<string>()
    const second = createChunkController<string>()

    const queryFn = vi.fn()
      .mockImplementationOnce(() => first.stream())
      .mockImplementationOnce(() => second.stream())

    const mounted = mountQuery({
      key: ['stream'],
      query: serializableStreamedQuery(queryFn, { refetchMode: 'append' }),
    })

    first.push('old')
    first.close()
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(['old']))

    const refetching = mounted.vm.query.refetch()

    second.push('a')
    // new chunks are appended to the previous data while the stream is open
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(['old', 'a']))
    expect(mounted.vm.query.asyncStatus.value).toEqual('loading')

    second.close()
    await refetching
    expect(mounted.vm.query.data.value).toEqual(['old', 'a'])
  })

  it('buffers and replaces with refetchMode=replace', async () => {
    const first = createChunkController<string>()
    const second = createChunkController<string>()

    const queryFn = vi.fn()
      .mockImplementationOnce(() => first.stream())
      .mockImplementationOnce(() => second.stream())

    const mounted = mountQuery({
      key: ['stream'],
      query: serializableStreamedQuery(queryFn, { refetchMode: 'replace' }),
    })

    first.push('old')
    first.close()
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(['old']))

    const refetching = mounted.vm.query.refetch()

    second.push('a')
    second.push('b')
    // previous data stays visible while the new stream is buffered
    await vi.waitFor(() => expect(mounted.vm.query.asyncStatus.value).toEqual('loading'))
    expect(mounted.vm.query.data.value).toEqual(['old'])

    second.close()
    await refetching
    expect(mounted.vm.query.data.value).toEqual(['a', 'b'])
  })

  it('updates the cache during stream on first fetch even with refetchMode=replace', async () => {
    const controller = createChunkController<string>()
    const mounted = mountQuery({
      key: ['stream'],
      query: serializableStreamedQuery(() => controller.stream(), { refetchMode: 'replace' }),
    })

    controller.push('a')
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(['a']))
    expect(mounted.vm.query.asyncStatus.value).toEqual('loading')

    controller.close()
    await vi.waitFor(() => expect(mounted.vm.query.asyncStatus.value).toEqual('idle'))
    expect(mounted.vm.query.data.value).toEqual(['a'])
  })

  it('limits chunks with maxChunks', async () => {
    const first = createChunkController<string>()
    const second = createChunkController<string>()

    const queryFn = vi.fn()
      .mockImplementationOnce(() => first.stream())
      .mockImplementationOnce(() => second.stream())

    const mounted = mountQuery({
      key: ['stream'],
      query: serializableStreamedQuery(queryFn, { refetchMode: 'append', maxChunks: 2 }),
    })

    first.push('old1')
    first.push('old2')
    first.close()
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(['old1', 'old2']))

    const refetching = mounted.vm.query.refetch()

    second.push('a')
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(['old2', 'a']))

    second.push('b')
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(['a', 'b']))

    second.close()
    await refetching
    expect(mounted.vm.query.data.value).toEqual(['a', 'b'])
  })

  it('stops streaming when the query is cancelled', async () => {
    const controller = createChunkController<string>()
    const mounted = mountQuery({
      key: ['stream'],
      query: serializableStreamedQuery(() => controller.stream()),
    })

    controller.push('a')
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(['a']))

    mounted.vm.queryCache.cancelQueries({ key: ['stream'] }, new Error('__cancelled__'))
    controller.push('b') // resumes the stream loop, which now observes the aborted signal

    await vi.waitFor(() => expect(mounted.vm.query.asyncStatus.value).toEqual('idle'))
    expect(mounted.vm.query.data.value).toEqual(['a'])
    expect(mounted.vm.query.error.value).toBeNull()
  })

  describe('cancels the stream once it is no longer used', () => {
    function createStreamedQuery() {
      const controller = createChunkController<number>()
      const onFinally = vi.fn()
      const signals: AbortSignal[] = []

      const query = serializableStreamedQuery(async function* ({ signal }) {
        signals.push(signal)

        try {
          yield* controller.stream()
        }
        finally {
          onFinally()
        }
      })

      return { controller, onFinally, signals, query }
    }

    /**
     * Mounts two consumers of the same query in one app, the second one rendered
     * conditionally like `v-if="showSecond"`.
     */
    function mountConsumers(useStreamQuery: () => unknown) {
      const Consumer = defineComponent({
        setup() {
          useStreamQuery()
        },
        render: () => null,
      })

      return mount(defineComponent({
        setup() {
          return { queryCache: useQueryCache(), showSecond: ref(true) }
        },
        render() {
          return [h(Consumer), this.showSecond ? h(Consumer) : null]
        },
      }), {
        global: {
          plugins: [
            createPinia(),
            PiniaColada,
          ],
        },
      })
    }

    it('when the last consumer unmounts', async () => {
      const { controller, onFinally, signals, query } = createStreamedQuery()
      const mounted = mountQuery({ key: ['stream'], query })

      controller.push(1)
      await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual([1]))
      const entry = mounted.vm.queryCache.get(['stream'])!

      mounted.unmount()
      expect(signals[0]!.aborted).toBe(true)
      expect(entry.asyncStatus.value).toEqual('idle')

      controller.push(2) // resumes the stream loop, which now observes the aborted signal
      await vi.waitFor(() => expect(onFinally).toHaveBeenCalledTimes(1))
      expect(entry.state.value).toEqual({ status: 'success', data: [1], error: null })
      expect(signals).toHaveLength(1)
    })

    it('when the entry is removed from the cache', async () => {
      const { controller, onFinally, signals, query } = createStreamedQuery()

      const app = createApp({}).use(createPinia()).use(PiniaColada)
      const queryCache = app.runWithContext(() => useQueryCache())
      const entry = queryCache.ensure({ key: ['stream'], query })
      const fetching = queryCache.fetch(entry)

      controller.push(1)
      await vi.waitFor(() => expect(entry.state.value.data).toEqual([1]))

      queryCache.remove(entry)
      expect(signals[0]!.aborted).toBe(true)

      controller.push(2)
      await expect(fetching).rejects.toBe(signals[0]!.reason)
      expect(onFinally).toHaveBeenCalledTimes(1)
      expect(entry.state.value).toEqual({ status: 'success', data: [1], error: null })
    })

    it.each(['useQuery', 'defineQuery'] as const)('not while another consumer of the same key is mounted (%s)', async (api) => {
      const { controller, signals, query } = createStreamedQuery()
      const options = { key: ['stream'], query }
      const mounted = mountConsumers(api === 'useQuery' ? () => useQuery(options) : defineQuery(options))
      const entry = mounted.vm.queryCache.get(['stream'])!

      controller.push(1)
      await vi.waitFor(() => expect(entry.state.value.data).toEqual([1]))
      expect(entry.deps.size).toBe(2)

      mounted.vm.showSecond = false
      await nextTick()
      expect(entry.deps.size).toBe(1)

      controller.push(2)
      await vi.waitFor(() => expect(entry.state.value.data).toEqual([1, 2]))
      expect(signals).toHaveLength(1)
      expect(signals[0]!.aborted).toBe(false)

      mounted.unmount()
      expect(signals[0]!.aborted).toBe(true)
    })
  })
})
