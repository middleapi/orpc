import type { Promisable } from '@orpc/shared'
import { stringifyJSON, throwIfAborted } from '@orpc/shared'

import type { SettleOnFirstDataOptions } from './stream-query.ts'
import type { UseQueryFnContext } from './types.ts'

/**
 * A Pinia Colada query function that publishes each streamed chunk to the
 * cache entry as it arrives, replacing the previous value.
 */
export function liveQuery<T>(
  queryFn: (context: UseQueryFnContext) => Promisable<AsyncIterable<T>>,
  { settleOnFirstData = false }: SettleOnFirstDataOptions = {},
): (context: UseQueryFnContext) => Promise<T> {
  return async (context) => {
    const { entry, signal } = context

    // a fetch cut short (cancelled, superseded, or its last component left) reopens when used again
    const markStale = () => {
      entry.when = 0
    }
    if (signal.aborted) {
      markStale()
    }
    signal.addEventListener('abort', markStale, { once: true })

    const stream = await queryFn(context)

    if (signal.aborted) {
      await stream[Symbol.asyncIterator]().return?.()
      throw signal.reason
    }

    let last: { chunk: T } | undefined

    for await (const chunk of stream) {
      throwIfAborted(signal)

      last = { chunk }
      entry.state.value = { status: 'success', data: chunk, error: null } as any

      if (settleOnFirstData) {
        break
      }
    }

    // a stream that ends on abort must not be stored as fresh data
    throwIfAborted(signal)

    if (!last) {
      throw new TypeError(
        `Live query for ${stringifyJSON(entry.key)} did not yield any data. Ensure the query function returns an AsyncIterable with at least one chunk.`,
      )
    }

    return last.chunk
  }
}
