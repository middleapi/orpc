import type { Promisable } from '@orpc/shared'
import { pipeStreamToCache, stringifyJSON } from '@orpc/shared'
import type { QueryFunction, QueryFunctionContext, QueryKey } from '@tanstack/query-core'

import type { SettleOnFirstDataOptions } from './stream-cache.ts'
import { followStream } from './stream-cache.ts'

export function liveQuery<TQueryFnData = unknown, TQueryKey extends QueryKey = QueryKey>(
  queryFn: (context: QueryFunctionContext<TQueryKey>) => Promisable<AsyncIterable<TQueryFnData>>,
  { settleOnFirstData }: SettleOnFirstDataOptions = {},
): QueryFunction<TQueryFnData, TQueryKey> {
  return async (context) => {
    const result = await followStream<QueryFunctionContext<TQueryKey>, TQueryFnData>(
      context,
      settleOnFirstData,
      async (callContext, writes) =>
        pipeStreamToCache(await queryFn(callContext), {
          ...writes,
          onChunk: (_, chunk) => {
            if (chunk === undefined) {
              throw new TypeError(
                `Live query for ${stringifyJSON(context.queryKey)} yielded \`undefined\`, which TanStack Query cannot store.`,
              )
            }

            return chunk
          },
        }),
    )

    if (!result) {
      throw new TypeError(
        `Live query for ${stringifyJSON(context.queryKey)} did not yield any data. Ensure the query function returns an AsyncIterable with at least one chunk.`,
      )
    }

    return result.data
  }
}
