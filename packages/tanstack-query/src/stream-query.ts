import type { Promisable, StreamedArrayOptions } from '@orpc/shared'
import { limitArraySize, pipeStreamToCache, streamedArrayWrites } from '@orpc/shared'
import type { QueryFunction, QueryFunctionContext, QueryKey } from '@tanstack/query-core'

import type { SettleOnFirstDataOptions } from './stream-cache.ts'
import { followStream } from './stream-cache.ts'

export type SerializableStreamedQueryOptions = StreamedArrayOptions

/**
 * A variant of `streamedQuery` where:
 * - Options are serializable
 * - The output is predictable
 */
export function serializableStreamedQuery<
  TQueryFnData = unknown,
  TQueryKey extends QueryKey = QueryKey,
>(
  queryFn: (context: QueryFunctionContext<TQueryKey>) => Promisable<AsyncIterable<TQueryFnData>>,
  {
    settleOnFirstData,
    ...options
  }: SerializableStreamedQueryOptions & SettleOnFirstDataOptions = {},
): QueryFunction<TQueryFnData[], TQueryKey> {
  return async (context) => {
    const result = await followStream<QueryFunctionContext<TQueryKey>, TQueryFnData[]>(
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
