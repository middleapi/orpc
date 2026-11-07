import type { Promisable } from '@orpc/shared'
import { stringifyJSON, throwIfAborted } from '@orpc/shared'
import type { QueryFunction, QueryFunctionContext, QueryKey } from '@tanstack/query-core'

import { getFetchingQuery } from './fetching-query.ts'
import type { SettleOnFirstDataOptions } from './stream-query.ts'

export function liveQuery<TQueryFnData = unknown, TQueryKey extends QueryKey = QueryKey>(
  queryFn: (context: QueryFunctionContext<TQueryKey>) => Promisable<AsyncIterable<TQueryFnData>>,
  { settleOnFirstData = false }: SettleOnFirstDataOptions = {},
): QueryFunction<TQueryFnData, TQueryKey> {
  return async (context) => {
    const { client, queryKey, signal } = context
    const query = getFetchingQuery<TQueryFnData>(client, queryKey)

    // a stream cut short (cancelled, or its last observer left) reopens when observed again;
    // marked at abort, so the writes of a fetch that replaces this one clear it
    const markStale = () => query.invalidate()
    if (signal.aborted) {
      markStale()
    }
    signal.addEventListener('abort', markStale, { once: true })

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
        query.setData(() => chunk)

        if (settleOnFirstData) {
          break
        }
      }

      if (!last) {
        throw new TypeError(
          `Live query for ${stringifyJSON(queryKey)} did not yield any data. Ensure the query function returns an AsyncIterable with at least one chunk.`,
        )
      }

      return last.chunk
    } finally {
      signal.removeEventListener('abort', markStale)
    }
  }
}
