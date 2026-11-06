import type { Promisable, StreamedArrayOptions } from '@orpc/shared'
import { limitArraySize, pipeStreamToCache, streamedArrayWrites } from '@orpc/shared'

import type { SettleOnFirstDataOptions } from './stream-cache.ts'
import { followEntryStream } from './stream-cache.ts'
import type { UseQueryFnContext } from './types.ts'

export type SerializableStreamedQueryOptions = StreamedArrayOptions

/**
 * A Pinia Colada query function that accumulates streamed chunks into an array,
 * publishing each chunk to the cache entry as it arrives.
 *
 * Inspired by [TanStack Query streamedQuery](https://tanstack.com/query/latest/docs/reference/streamedQuery) where:
 * - Options are serializable
 * - The output is predictable
 */
export function serializableStreamedQuery<T>(
  queryFn: (context: UseQueryFnContext) => Promisable<AsyncIterable<T>>,
  {
    settleOnFirstData,
    ...options
  }: SerializableStreamedQueryOptions & SettleOnFirstDataOptions = {},
): (context: UseQueryFnContext) => Promise<T[]> {
  return async (context) => {
    const result = await followEntryStream<T[]>(
      context,
      settleOnFirstData,
      async (callContext, writes) =>
        pipeStreamToCache(await queryFn(callContext), {
          ...writes,
          ...streamedArrayWrites(options),
        }),
    )

    return limitArraySize(result!.data, options.maxChunks ?? Number.POSITIVE_INFINITY)
  }
}
