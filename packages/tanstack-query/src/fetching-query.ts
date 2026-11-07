import type { Query, QueryClient, QueryKey } from '@tanstack/query-core'

/**
 * Finds the query being fetched by key reference, since `setQueryData` ignores its own `queryKeyHashFn`.
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

  return query ?? cache.build(client, client.defaultQueryOptions({ queryKey }))
}
