import type { Query, QueryClient, QueryKey } from '@tanstack/query-core'

/**
 * Finds the query being fetched with `queryKey`, to read and write its data directly.
 *
 * `setQueryData` and `getQueryData` hash the key with the client defaults,
 * so they miss a query with its own `queryKeyHashFn` and write to a separate entry.
 * A query passes its own key to its query function, so it is found by reference:
 * no hashing, so other queries' hash functions never run on this key.
 */
export function getFetchingQuery<TData>(
  client: QueryClient,
  queryKey: QueryKey,
): Query<any, any, TData> {
  const cache = client.getQueryCache()
  const query = cache
    .getAll()
    .find((query) => query.queryKey === queryKey && query.state.fetchStatus === 'fetching') as
    | Query<any, any, TData>
    | undefined

  // called outside a fetch (e.g. directly), so use the entry `setQueryData` would
  return query ?? cache.build(client, client.defaultQueryOptions({ queryKey }))
}
