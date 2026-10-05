import type { AnyNestedClient } from '@orpc/client'
import type { CacheLinkPluginContext } from '@orpc/experimental-cache'
import type { InfiniteData, Query, QueryClient, QueryKey } from '@tanstack/query-core'
import type { RouterUtilsPlugin } from './plugin'
import type { RouterUtilsOptions } from './router-utils'
import { CACHE_LINK_PLUGIN_CONTEXT_SYMBOL } from '@orpc/experimental-cache'
import { toArray } from '@orpc/shared'
import { partialMatchKey, replaceEqualDeep } from '@tanstack/query-core'
import { generateOperationKey } from './key'

type AnyQuery = Query<any, any, any, any>

/**
 * The cache tags of each fetched query, shared by every plugin instance and
 * released together with the query.
 */
const QUERY_CACHE_TAGS = new WeakMap<AnyQuery, readonly string[]>()

/**
 * The cache tags of each fetched infinite query page, by page param. Every
 * page of one fetch shares its signal, so a refetch of all pages starts over,
 * and one that fails partway leaves the pages it did not reach untracked
 * rather than pairing its tags with data it never committed.
 */
const INFINITE_QUERY_CACHE_TAGS = new WeakMap<AnyQuery, { signal: AbortSignal, pages: Map<unknown, readonly string[]> }>()

/**
 * Calls `next` with a cache link plugin context, reusing one an outer reader
 * already placed, and returns the output along with the tags the response
 * carried.
 */
async function callWithCacheTags<TOutput>(
  { next, ...options }: { next: (options: any) => Promise<TOutput>, context: object },
) {
  const pluginContext = (options.context as CacheLinkPluginContext)[CACHE_LINK_PLUGIN_CONTEXT_SYMBOL] ?? { tags: [], revalidatedTags: [] }

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
 * The tags recorded for a page param. Structural sharing keeps an earlier
 * param in the data in place of an equal one fetched later, so a miss looks
 * for the recorded param it would have kept.
 */
function getPageCacheTags(pages: Map<unknown, readonly string[]>, pageParam: unknown): readonly string[] | undefined {
  const tags = pages.get(pageParam)

  if (tags !== undefined) {
    return tags
  }

  for (const [recordedPageParam, recordedTags] of pages) {
    if (replaceEqualDeep(recordedPageParam, pageParam) === recordedPageParam) {
      return recordedTags
    }
  }

  return undefined
}

/**
 * The tags the loaded data depends on, or `undefined` when some of it was
 * not fetched through the plugin, such as data hydrated from server-side
 * rendering.
 */
function getCacheTags(query: AnyQuery): readonly string[] | undefined {
  const infinite = INFINITE_QUERY_CACHE_TAGS.get(query)

  if (infinite === undefined) {
    return QUERY_CACHE_TAGS.get(query)
  }

  const tags: string[] = []

  for (const pageParam of (query.state.data as InfiniteData<unknown> | undefined)?.pageParams ?? []) {
    const pageTags = getPageCacheTags(infinite.pages, pageParam)

    if (pageTags === undefined) {
      return undefined
    }

    tags.push(...pageTags)
  }

  return tags
}

/**
 * Tracks the cache tags the server reports for queries and infinite queries.
 * When a mutation revalidates tags, invalidates the affected queries and
 * waits for the active ones to refetch before the mutation succeeds. Data
 * not fetched through the plugin, such as data hydrated from server-side
 * rendering, counts as affected until a fetch reveals its tags. Needs the
 * `CacheLinkPlugin` on the link.
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
            QUERY_CACHE_TAGS.set(query, tags)
          }

          return output
        },
      ],
      infiniteInterceptors: [
        ...toArray(options.infiniteInterceptors),
        async (interceptorOptions) => {
          const { output, tags } = await callWithCacheTags(interceptorOptions)
          const { client, queryKey, signal, pageParam } = interceptorOptions.fnContext
          const query = findQuery(client, queryKey)

          if (query !== undefined) {
            let infinite = INFINITE_QUERY_CACHE_TAGS.get(query)

            if (infinite === undefined || (infinite.signal !== signal && query.state.fetchMeta?.fetchMore === undefined)) {
              infinite = { signal, pages: new Map() }
              INFINITE_QUERY_CACHE_TAGS.set(query, infinite)
            }

            infinite.pages.set(pageParam, tags)
          }

          return output
        },
      ],
      mutationInterceptors: [
        ...toArray(options.mutationInterceptors),
        async (interceptorOptions) => {
          const { output, revalidatedTags } = await callWithCacheTags(interceptorOptions)

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
