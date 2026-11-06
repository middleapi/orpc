import type { Promisable } from '@orpc/shared'
import { stringifyJSON, throwIfAborted } from '@orpc/shared'
import type { QueryFunction, QueryFunctionContext, QueryKey } from '@tanstack/query-core'

import type { SettleOnFirstDataOptions } from './stream-query.ts'

export function liveQuery<TQueryFnData = unknown, TQueryKey extends QueryKey = QueryKey>(
  queryFn: (context: QueryFunctionContext<TQueryKey>) => Promisable<AsyncIterable<TQueryFnData>>,
  { settleOnFirstData = false }: SettleOnFirstDataOptions = {},
): QueryFunction<TQueryFnData, TQueryKey> {
  return async (context) => {
    const { client, queryKey, signal } = context

    try {
      const stream = await queryFn(context)

      if (signal.aborted) {
        await stream[Symbol.asyncIterator]().return?.()
        throw signal.reason
      }

      let last: { chunk: TQueryFnData } | undefined

      for await (const chunk of stream) {
        throwIfAborted(signal)

        last = { chunk }
        client.setQueryData<TQueryFnData>(queryKey, chunk)

        if (settleOnFirstData) {
          break
        }
      }

      if (!last) {
        throw new TypeError(
          `Live query for ${stringifyJSON(queryKey)} did not yield any data. Ensure the query function returns an AsyncIterable with at least one chunk.`,
        )
      }

      // the returned data is written again, so return the cache to keep later writes
      const cached = client.getQueryData<TQueryFnData>(queryKey)
      return cached === undefined ? last.chunk : cached
    } catch (error) {
      // a stream cut short (cancelled, or its last observer left) reopens when observed again
      if (signal.aborted) {
        client.getQueryCache().find({ queryKey, exact: true })?.invalidate()
      }

      throw error
    }
  }
}
