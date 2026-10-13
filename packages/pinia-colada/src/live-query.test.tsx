import type { UseQueryOptions } from '@pinia/colada'
import { PiniaColada, useQuery, useQueryCache } from '@pinia/colada'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { defineComponent, h, nextTick, ref } from 'vue'
import { liveQuery } from './live-query'

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

describe('liveQuery', () => {
  it('publishes each chunk to the cache, replacing the previous value', async () => {
    const controller = createChunkController<number>()
    const mounted = mountQuery({
      key: ['live'],
      query: liveQuery(() => controller.stream()),
    })

    controller.push(1)
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(1))
    expect(mounted.vm.query.asyncStatus.value).toEqual('loading')

    controller.push(2)
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(2))
    expect(mounted.vm.query.asyncStatus.value).toEqual('loading')

    controller.close()
    await vi.waitFor(() => expect(mounted.vm.query.asyncStatus.value).toEqual('idle'))
    expect(mounted.vm.query.data.value).toEqual(2)
    expect(mounted.vm.query.status.value).toEqual('success')
    expect(mounted.vm.queryCache.getQueryData(['live'])).toEqual(2)
  })

  it('errors when the stream yields no chunks', async () => {
    const controller = createChunkController<number>()
    const mounted = mountQuery({
      key: ['live'],
      query: liveQuery(() => controller.stream()),
    })

    controller.close()

    await vi.waitFor(() => expect(mounted.vm.query.error.value).toBeInstanceOf(TypeError))
    expect((mounted.vm.query.error.value as any).message).toContain('did not yield any data')
    expect(mounted.vm.query.status.value).toEqual('error')
  })

  it('stops streaming when the query is cancelled', async () => {
    const controller = createChunkController<number>()
    const mounted = mountQuery({
      key: ['live'],
      query: liveQuery(() => controller.stream()),
    })

    controller.push(1)
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(1))

    mounted.vm.queryCache.cancelQueries({ key: ['live'] }, new Error('__cancelled__'))
    controller.push(2) // resumes the stream loop, which now observes the aborted signal

    await vi.waitFor(() => expect(mounted.vm.query.asyncStatus.value).toEqual('idle'))
    expect(mounted.vm.query.data.value).toEqual(1)
    expect(mounted.vm.query.error.value).toBeNull()
  })

  describe('cancels the stream once it is no longer used', () => {
    function createLiveQuery() {
      const controller = createChunkController<number>()
      const onFinally = vi.fn()
      const signals: AbortSignal[] = []

      const query = liveQuery(async function* ({ signal }) {
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

    it('when the last consumer unmounts', async () => {
      const { controller, onFinally, signals, query } = createLiveQuery()
      const mounted = mountQuery({ key: ['live'], query })

      controller.push(1)
      await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(1))
      const entry = mounted.vm.queryCache.get(['live'])!

      mounted.unmount()
      expect(signals[0]!.aborted).toBe(true)
      expect(entry.asyncStatus.value).toEqual('idle')

      controller.push(2) // resumes the stream loop, which now observes the aborted signal
      await vi.waitFor(() => expect(onFinally).toHaveBeenCalledTimes(1))
      expect(entry.state.value).toEqual({ status: 'success', data: 1, error: null })
      expect(signals).toHaveLength(1)
    })

    it('not while another consumer of the same key is mounted', async () => {
      const { controller, signals, query } = createLiveQuery()

      const Consumer = defineComponent({
        setup() {
          useQuery({ key: ['live'], query })
        },
        render: () => null,
      })

      const mounted = mount(defineComponent({
        setup() {
          return { queryCache: useQueryCache(), showSecond: ref(true) }
        },
        render() {
          // like `v-if="showSecond"` on the second consumer
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

      const entry = mounted.vm.queryCache.get(['live'])!

      controller.push(1)
      await vi.waitFor(() => expect(entry.state.value.data).toEqual(1))
      expect(entry.deps.size).toBe(2)

      mounted.vm.showSecond = false
      await nextTick()
      expect(entry.deps.size).toBe(1)

      controller.push(2)
      await vi.waitFor(() => expect(entry.state.value.data).toEqual(2))
      expect(signals).toHaveLength(1)
      expect(signals[0]!.aborted).toBe(false)

      mounted.unmount()
      expect(signals[0]!.aborted).toBe(true)
    })
  })
})
