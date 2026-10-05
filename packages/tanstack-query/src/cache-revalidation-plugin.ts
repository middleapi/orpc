import type { AnyNestedClient } from '@orpc/client'
import type { CacheLinkPluginContext } from '@orpc/experimental-cache'
import type { InfiniteData, Query, QueryClient, QueryKey } from '@tanstack/query-core'
import type { RouterUtilsPlugin } from './plugin'
import type { RouterUtilsOptions } from './router-utils'
import { CACHE_LINK_PLUGIN_CONTEXT_SYMBOL } from '@orpc/experimental-cache'
import { toArray } from '@orpc/shared'
import { partialMatchKey } from '@tanstack/query-core'
import { generateOperationKey } from './key'

type AnyQuery = Query<any, any, any, any>

type PageCacheTags = readonly string[] | null

/**
 * The cache tags kept in a query's state, so they travel with dehydration.
 * Unknown tags are `null`, which survives serialization.
 */
interface CacheTagsQueryState {
  /**
   * The tags the data of a query depends on.
   */
  orpcCacheTags?: readonly string[] | null

  /**
   * The tags each page of an infinite query depends on, in page order.
   */
  orpcCachePageTags?: readonly PageCacheTags[]

  /**
   * The `dataUpdateCount` of the data the tags describe. Data committed any
   * other way, such as by hydration or `setQueryData`, leaves them unknown.
   */
  orpcCacheTagsDataUpdateCount?: number
}

/**
 * The fetch of all pages each infinite query is in. Its pages arrive in order
 * and share its signal, retries included, which resume from the failed page.
 */
const INFINITE_QUERY_FETCHES = new WeakMap<AnyQuery, { signal: AbortSignal, pageTags: PageCacheTags[] }>()

/**
 * Calls `next` with a cache link plugin context, reusing one an outer reader
 * already placed, and returns the output along with the tags the response
 * carried, if anything reported them.
 */
async function callWithCacheTags<TOutput>(
  { next, ...options }: { next: (options: any) => Promise<TOutput>, context: object },
) {
  const pluginContext = (options.context as CacheLinkPluginContext)[CACHE_LINK_PLUGIN_CONTEXT_SYMBOL] ?? {}

  const output = await next({
    ...options,
    context: { ...options.context, [CACHE_LINK_PLUGIN_CONTEXT_SYMBOL]: pluginContext },
  })

  return { output, ...pluginContext }
}

/**
 * Looks up the query being fetched by its hash, as `QueryClient#getQueryData` does.
 */
function findQuery(client: QueryClient, queryKey: QueryKey): AnyQuery | undefined {
  return client.getQueryCache().get(client.defaultQueryOptions({ queryKey }).queryHash)
}

/**
 * Records the tags of the data the running fetch is about to commit.
 */
function setCacheTagsState(query: AnyQuery, tags: Pick<CacheTagsQueryState, 'orpcCacheTags' | 'orpcCachePageTags'>): void {
  const state: CacheTagsQueryState = { ...tags, orpcCacheTagsDataUpdateCount: query.state.dataUpdateCount + 1 }

  query.setState({ ...query.state, ...state })
}

/**
 * The tag state recorded for the loaded data, if any.
 */
function getCacheTagsState(query: AnyQuery): CacheTagsQueryState | undefined {
  const state = query.state as CacheTagsQueryState

  return state.orpcCacheTagsDataUpdateCount === query.state.dataUpdateCount ? state : undefined
}

/**
 * The tags the loaded data depends on, or `undefined` when some of it was not
 * fetched with its tags reported, such as data hydrated from a server render
 * that did not report them.
 */
function getCacheTags(query: AnyQuery): readonly string[] | undefined {
  const state = getCacheTagsState(query)

  if (state?.orpcCachePageTags === undefined) {
    return state?.orpcCacheTags ?? undefined
  }

  const { orpcCachePageTags } = state

  const pages = (query.state.data as InfiniteData<unknown> | undefined)?.pages ?? []

  if (orpcCachePageTags.length !== pages.length || !orpcCachePageTags.every(tags => tags !== null)) {
    return undefined
  }

  return orpcCachePageTags.flat()
}

/**
 * Tracks the cache tags the server reports for queries and infinite queries,
 * keeping them in the query state so they survive dehydration. When a
 * mutation revalidates tags, invalidates the affected queries and waits for
 * the active ones to refetch before the mutation succeeds. Data whose tags are
 * unknown counts as affected until a fetch reveals them. Needs the
 * `CacheLinkPlugin` on the link, or `cacheRouterClientInterceptor` on a
 * server-side client.
 *
 * @see {@link https://orpc.dev/docs/integrations/tanstack-query#cache-revalidation-plugin | TanStack Query Integration - Cache Revalidation Plugin}
 */
export class experimental_CacheRevalidationUtilsPlugin<T extends AnyNestedClient> implements RouterUtilsPlugin<T> {
  readonly name = '~cache-revalidation'

  init(options: RouterUtilsOptions<T>): RouterUtilsOptions<T> {
    const path = toArray(options.path)
    const queryFilterKey = generateOperationKey(path, { prefix: options.prefix, type: 'query' })
    const infiniteFilterKey = generateOperationKey(path, { prefix: options.prefix, type: 'infinite' })
    const isUtilsQuery = (query: AnyQuery) =>
      partialMatchKey(query.queryKey, queryFilterKey) || partialMatchKey(query.queryKey, infiniteFilterKey)

    return {
      ...options,
      queryInterceptors: [
        ...toArray(options.queryInterceptors),
        async (interceptorOptions) => {
          const { output, tags } = await callWithCacheTags(interceptorOptions)
          const query = findQuery(interceptorOptions.fnContext.client, interceptorOptions.fnContext.queryKey)

          if (query !== undefined) {
            setCacheTagsState(query, { orpcCacheTags: tags ?? null })
          }

          return output
        },
      ],
      infiniteInterceptors: [
        ...toArray(options.infiniteInterceptors),
        async (interceptorOptions) => {
          const { output, tags = null } = await callWithCacheTags(interceptorOptions)
          const { client, queryKey, signal } = interceptorOptions.fnContext
          const query = findQuery(client, queryKey)

          if (query === undefined) {
            return output
          }

          const fetchMore = query.state.fetchMeta?.fetchMore
          const { maxPages } = query.options

          if (fetchMore === undefined) {
            let fetch = INFINITE_QUERY_FETCHES.get(query)

            if (fetch?.signal !== signal) {
              fetch = { signal, pageTags: [] }
              INFINITE_QUERY_FETCHES.set(query, fetch)
            }

            fetch.pageTags.push(tags)

            if (maxPages && fetch.pageTags.length > maxPages) {
              fetch.pageTags.shift()
            }

            setCacheTagsState(query, { orpcCachePageTags: [...fetch.pageTags] })

            return output
          }

          /**
           * Pages are added the way TanStack Query adds them, dropping one
           * from the other end beyond `maxPages`.
           */
          const pages = (query.state.data as InfiniteData<unknown> | undefined)?.pages ?? []
          const known = getCacheTagsState(query)?.orpcCachePageTags
          const current = known?.length === pages.length ? known : pages.map(() => null)
          const pageTags = fetchMore.direction === 'forward' ? [...current, tags] : [tags, ...current]

          if (maxPages && pageTags.length > maxPages) {
            if (fetchMore.direction === 'forward') {
              pageTags.shift()
            }
            else {
              pageTags.pop()
            }
          }

          setCacheTagsState(query, { orpcCachePageTags: pageTags })

          return output
        },
      ],
      mutationInterceptors: [
        ...toArray(options.mutationInterceptors),
        async (interceptorOptions) => {
          const { output, revalidatedTags = [] } = await callWithCacheTags(interceptorOptions)

          if (revalidatedTags.length) {
            const { client } = interceptorOptions.fnContext

            /**
             * A first load still in flight may have read data the mutation
             * changed, such as one batched with it, and invalidating it would
             * only join that fetch, so let it land and reveal its tags first.
             */
            await client.refetchQueries(
              { fetchStatus: 'fetching', predicate: query => query.state.data === undefined && isUtilsQuery(query) },
              { cancelRefetch: false },
            )

            await client.invalidateQueries({
              predicate: (query) => {
                const tags = getCacheTags(query)

                if (tags === undefined) {
                  return query.state.data !== undefined && isUtilsQuery(query)
                }

                return tags.some(tag => revalidatedTags.includes(tag))
              },
            })
          }

          return output
        },
      ],
    }
  }
}
