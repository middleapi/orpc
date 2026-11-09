import type { Promisable } from '@orpc/shared'
import { listenAbort, stringifyJSON, throwIfAborted } from '@orpc/shared'

import type { SettleOnFirstDataOptions } from './stream-query'
import type { UseQueryFnContext } from './types'

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
    listenAbort(signal, () => {
      entry.when = 0
    })

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
