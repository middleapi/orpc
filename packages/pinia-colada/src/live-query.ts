import type { Promisable } from '@orpc/shared'
import { pipeStreamToCache, stringifyJSON } from '@orpc/shared'

import type { SettleOnFirstDataOptions } from './stream-cache.ts'
import { followEntryStream } from './stream-cache.ts'
import type { UseQueryFnContext } from './types.ts'

/**
 * A Pinia Colada query function that publishes each streamed chunk to the
 * cache entry as it arrives, replacing the previous value.
 */
export function liveQuery<T>(
  queryFn: (context: UseQueryFnContext) => Promisable<AsyncIterable<T>>,
  { settleOnFirstData }: SettleOnFirstDataOptions = {},
): (context: UseQueryFnContext) => Promise<T> {
  return async (context) => {
    const result = await followEntryStream<T>(
      context,
      settleOnFirstData,
      async (callContext, writes) =>
        pipeStreamToCache(await queryFn(callContext), { ...writes, onChunk: (_, chunk) => chunk }),
    )

    if (!result) {
      throw new TypeError(
        `Live query for ${stringifyJSON(context.entry.key)} did not yield any data. Ensure the query function returns an AsyncIterable with at least one chunk.`,
      )
    }

    return result.data
  }
}
