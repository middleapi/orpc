import type { Promisable } from '@orpc/shared'
import { throwIfAborted } from '@orpc/shared'
import type { QueryFunction, QueryFunctionContext, QueryKey } from '@tanstack/query-core'

import { getFetchingQuery } from './fetching-query.ts'

export interface SerializableStreamedQueryOptions {
  /**
   * What a fetch does with existing data once its stream connects.
   * Until then the data stays, so a query with data never returns to `pending`.
   *
   * - `'reset'`: the data becomes `[]`, then each chunk is appended.
   * - `'append'`: the data is kept (trimmed to `maxChunks`), and each chunk is appended.
   *
   * @default 'reset'
   */
  refetchMode?: 'append' | 'reset' | undefined

  /**
   * Limits the number of data chunks stored in the query result.
   * Older chunks are removed when the limit is reached.
   *
   * @default Number.POSITIVE_INFINITY (unlimited)
   */
  maxChunks?: number | undefined
}

export interface SettleOnFirstDataOptions {
  /**
   * Settles the fetch at its first data (streamed: when the stream connects; live: on the first event)
   * instead of following the stream to its end. The stream is closed and the data kept.
   * Use it only where nothing watches the stream, such as server rendering:
   * a refetch while a query is mounted would also settle, closing its stream.
   *
   * @default false
   */
  settleOnFirstData?: boolean | undefined
}

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
    refetchMode = 'reset',
    maxChunks = Number.POSITIVE_INFINITY,
    settleOnFirstData = false,
  }: SerializableStreamedQueryOptions & SettleOnFirstDataOptions = {},
): QueryFunction<TQueryFnData[], TQueryKey> {
  return async (context) => {
    const { client, queryKey, signal } = context
    const query = getFetchingQuery<TQueryFnData[]>(client, queryKey)

    // a stream cut short (cancelled, or its last observer left) reopens when observed again;
    // marked at abort, so the writes of a fetch that replaces this one clear it
    const markStale = () => query.invalidate()
    if (signal.aborted) {
      markStale()
    }
    signal.addEventListener('abort', markStale, { once: true })

    try {
      const stream = await queryFn(context)

      // close without reading, so a generator the query no longer wants never starts
      if (signal.aborted) {
        await stream[Symbol.asyncIterator]().return?.()
        throw signal.reason
      }

      let data = query.setData(
        refetchMode === 'append' && query.state.data
          ? limitArraySize(query.state.data, maxChunks)
          : [],
        { manual: true },
      )

      if (settleOnFirstData) {
        await stream[Symbol.asyncIterator]().return?.()
        return data
      }

      for await (const chunk of stream) {
        throwIfAborted(signal)

        // read the cache, so writes made during the stream are kept
        data = query.setData(limitArraySize([...(query.state.data ?? []), chunk], maxChunks), {
          manual: true,
        })
      }

      // the returned data is written again, so return the cache to keep later writes
      const cached = query.state.data
      if (cached === undefined) {
        return data
      }

      // only an array is trimmed; another value written after the stream (e.g. `null`) is kept as is
      return Array.isArray(cached) ? limitArraySize(cached, maxChunks) : cached
    } finally {
      signal.removeEventListener('abort', markStale)
    }
  }
}

function limitArraySize<T>(items: T[], maxSize: number): T[] {
  if (items.length <= maxSize) {
    return items
  }

  return items.slice(items.length - maxSize)
}
