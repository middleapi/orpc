import type { AnyProcedure, Context } from '@orpc/server'
import type { StandardHandlerInterceptor, StandardHandlerOptions, StandardHandlerPlugin } from '@orpc/server/standard'
import type { StandardHeaders } from '@standard-server/core'
import { encodeCacheTagHeader, toArray } from '@orpc/shared'

export const CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL: unique symbol = Symbol.for('ORPC_CACHE_HANDLER_PLUGIN_CONTEXT')

/**
 * A cache lookup performed during a request. `ttl` carries the remaining
 * freshness in milliseconds on hits and the resolved fresh lifetime on stores.
 */
export interface CacheHandlerPluginLookup {
  procedure: AnyProcedure
  path: readonly string[]
  tags?: readonly string[] | undefined
  ttl?: number | undefined
  swr?: number | undefined
}

/**
 * A tag revalidation committed during a request.
 */
export interface CacheHandlerPluginRevalidation {
  procedure: AnyProcedure
  path: readonly string[]
  tags: readonly string[]
}

export interface CacheHandlerPluginContext {
  [CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]?: {
    /**
     * The cache lookups performed during this request, in the order they ran.
     */
    caches: CacheHandlerPluginLookup[]

    /**
     * The tag revalidations committed during this request, in the order they ran.
     */
    revalidations: CacheHandlerPluginRevalidation[]
  }
}

/**
 * The response headers the cache handler plugin can set.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#handler-plugin | Cache Helpers - Handler Plugin}
 */
export type CacheHandlerPluginHeader
  = | 'orpc-cache-tag'
    | 'orpc-cache-tag-invalidation'
    | 'cache-control'
    | 'cache-tag'

export interface CacheHandlerPluginOptions<_T extends Context> {
  /**
   * The response headers to set from the root procedure's cache activity;
   * only listed headers are set. `orpc-cache-tag` carries the tags the
   * response depends on and `orpc-cache-tag-invalidation` the tags
   * revalidated by the request, for client-side revalidation. `cache-tag`
   * and `cache-control` are their standard HTTP counterparts for response
   * caches in front, such as CDNs or Cloudflare Workers Caching.
   */
  headers: readonly CacheHandlerPluginHeader[]
}

/**
 * Reflects the cache activity of the `cache` and `revalidate` middlewares
 * into the configured response headers. Only the first check belonging to
 * the procedure the client called is reflected, so nested procedure calls
 * never leak their tags into the response. Does nothing until headers are
 * configured.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#handler-plugin | Cache Helpers - Handler Plugin}
 */
export class CacheHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~cache'

  private readonly headers: Set<CacheHandlerPluginHeader>

  constructor(options: CacheHandlerPluginOptions<T>) {
    this.headers = new Set(options.headers)
  }

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    if (!this.headers.size) {
      return options
    }

    const interceptor: StandardHandlerInterceptor<T> = async (interceptorOptions) => {
      const pluginContext: Exclude<CacheHandlerPluginContext[typeof CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL], undefined> = { caches: [], revalidations: [] }

      const response = await interceptorOptions.next({
        ...interceptorOptions,
        context: {
          ...interceptorOptions.context,
          [CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]: pluginContext,
        } satisfies CacheHandlerPluginContext,
      })

      const { procedure, path } = interceptorOptions
      const isRoot = (check: CacheHandlerPluginRevalidation | CacheHandlerPluginLookup) =>
        check.procedure === procedure && check.path.length === path.length && check.path.every((segment, index) => segment === path[index])

      const rootCache = pluginContext.caches.find(isRoot)
      const rootRevalidation = pluginContext.revalidations.find(isRoot)

      if (rootCache === undefined && rootRevalidation === undefined) {
        return response
      }

      const headers: StandardHeaders = {}
      const set = (name: CacheHandlerPluginHeader, value: string | undefined) => {
        if (value !== undefined && this.headers.has(name)) {
          headers[name] = value
        }
      }

      const cacheTag = rootCache?.tags?.length ? encodeCacheTagHeader(rootCache.tags) : undefined
      set('orpc-cache-tag', cacheTag)
      set('cache-tag', cacheTag)
      set('orpc-cache-tag-invalidation', rootRevalidation?.tags.length ? encodeCacheTagHeader(rootRevalidation.tags) : undefined)

      if (rootCache !== undefined && this.headers.has('cache-control')) {
        /**
         * `max-age` rather than `s-maxage`, which carries `proxy-revalidate`
         * semantics ([RFC 9111](https://www.rfc-editor.org/rfc/rfc9111#section-5.2.2.10))
         * and so forbids the stale reuse `stale-while-revalidate` grants.
         * Entries without a ttl stay valid until revalidated, so caches hold
         * them for a year and rely on tag purges.
         */
        const maxAge = rootCache.ttl === undefined ? 31536000 : Math.floor(rootCache.ttl / 1000)
        const staleWhileRevalidate = Math.floor((rootCache.swr ?? 0) / 1000)
        headers['cache-control'] = `public, max-age=${maxAge}${staleWhileRevalidate ? `, stale-while-revalidate=${staleWhileRevalidate}` : ''}`
      }

      return {
        ...response,
        headers: { ...response.headers, ...headers },
      }
    }

    return {
      ...options,
      interceptors: [
        ...toArray(options.interceptors),
        interceptor,
      ],
    }
  }
}
