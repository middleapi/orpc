import type { UseQueryOptions } from '@pinia/colada'
import { PiniaColada, useQuery, useQueryCache } from '@pinia/colada'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { defineComponent } from 'vue'

/**
 * Mounts a component that runs a real Pinia Colada `useQuery`,
 * so tests can observe exactly what users see.
 */
export function mountQuery(options: UseQueryOptions<any, any, any>) {
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
export function createChunkController<T>() {
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
