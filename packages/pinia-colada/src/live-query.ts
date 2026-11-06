import type { Promisable } from '@orpc/shared'
import { stringifyJSON } from '@orpc/shared'

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
    signal.addEventListener('abort', () => (entry.when = 0), { once: true })

    const stream = await queryFn(context)

    if (signal.aborted) {
      await stream[Symbol.asyncIterator]().return?.()
      throw signal.reason
    }

    let last: { chunk: T } | undefined

    for await (const chunk of stream) {
      if (signal.aborted) {
        throw signal.reason
      }

      last = { chunk }
      entry.state.value = { status: 'success', data: chunk, error: null } as any

      if (settleOnFirstData) {
        break
      }
    }

    if (!last) {
      throw new TypeError(
        `Live query for ${stringifyJSON(entry.key)} did not yield any data. Ensure the query function returns an AsyncIterable with at least one chunk.`,
      )
    }

    // Colada writes the returned data again, so return the entry data to keep later writes
    return entry.state.value.data as T
  }
}
