import type { Query, QueryClient, QueryKey } from '@tanstack/query-core'

export interface FetchingQuery<TData> {
  getData(): TData | undefined
  /**
   * Like `setQueryData`: skips the write when the updater returns `undefined`.
   */
  setData(updater: (current: TData | undefined) => TData | undefined): TData | undefined
  invalidate(): void
}

/**
 * Accesses the cache entry of the query being fetched with `queryKey`.
 *
 * `setQueryData` and `getQueryData` hash the key with the client defaults,
 * so they miss a query with its own `queryKeyHashFn` and write to a separate entry.
 * Exact filters hash the key with each query's own options instead.
 */
export function getFetchingQuery<TData>(
  client: QueryClient,
  queryKey: QueryKey,
): FetchingQuery<TData> {
  const query: Query<any, any, TData> | undefined = client
    .getQueryCache()
    .find({ queryKey, exact: true, fetchStatus: 'fetching' })

  if (!query) {
    // called outside a fetch of the query cache, e.g. directly
    return {
      getData: () => client.getQueryData<TData>(queryKey),
      setData: (updater) => client.setQueryData<TData>(queryKey, updater),
      invalidate: () => client.getQueryCache().find({ queryKey, exact: true })?.invalidate(),
    }
  }

  return {
    getData: () => query.state.data,
    setData: (updater) => {
      const data = updater(query.state.data)
      return data === undefined ? undefined : query.setData(data, { manual: true })
    },
    invalidate: () => query.invalidate(),
  }
}
