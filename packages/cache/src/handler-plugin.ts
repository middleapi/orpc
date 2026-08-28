import type { AnyProcedure, Context } from '@orpc/server'
import type { StandardHandlerInterceptor, StandardHandlerOptions, StandardHandlerPlugin } from '@orpc/server/standard'
import type { StandardHeaders } from '@standardserver/core'
import { isDeepEqual, toArray, tryDecodeURIComponent } from '@orpc/shared'

export const CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL: unique symbol = Symbol.for('ORPC_CACHE_HANDLER_PLUGIN_CONTEXT')

export interface CacheHandlerPluginContext {
  [CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]?: {
    /**
     * The cache lookups performed during this request, both hits and stores.
     * `ttl` carries the remaining freshness in milliseconds on hits and the
     * resolved fresh lifetime on stores.
     */
    caches: { procedure: AnyProcedure, path: string[], hit: boolean, stale: boolean, key: unknown, tags: readonly string[], ttl?: number | undefined, swr?: number | undefined }[]

    /**
     * The tag revalidations committed during this request.
     */
    revalidations: { procedure: AnyProcedure, path: string[], tags: readonly string[] }[]
  }
}

/**
 * The response header carrying the tags the cached response depends on.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#handler-plugin | Cache Helpers - Handler Plugin}
 */
export const CACHE_TAG_HEADER = 'orpc-cache-tag'

/**
 * The response header carrying the tags revalidated by the request,
 * useful for invalidating tagged data in client caches.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#handler-plugin | Cache Helpers - Handler Plugin}
 */
export const CACHE_TAG_INVALIDATION_HEADER = 'orpc-cache-tag-invalidation'

/**
 * Encodes cache tags into a header value: tags are joined with commas, and
 * only `%`, `,`, and characters that cannot appear in a header value
 * (whitespace, control characters, non-ASCII) are percent-encoded, so
 * typical tags stay readable.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#handler-plugin | Cache Helpers - Handler Plugin}
 */
export function encodeCacheTagHeader(tags: readonly string[]): string {
  return tags.map(tag => tag.replace(/[^\x21-\x7E]|[%,]/gu, c => encodeURIComponent(c))).join(',')
}

/**
 * Decodes a header value produced by {@link encodeCacheTagHeader} back into tags.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#handler-plugin | Cache Helpers - Handler Plugin}
 */
export function decodeCacheTagHeader(header: string): string[] {
  return header.split(',').filter(Boolean).map(tryDecodeURIComponent)
}

/**
 * The response headers the cache handler plugin can set.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#handler-plugin | Cache Helpers - Handler Plugin}
 */
export type CacheHandlerPluginHeader
  = | typeof CACHE_TAG_HEADER
    | typeof CACHE_TAG_INVALIDATION_HEADER
    | 'cache-control'
    | 'cache-tag'

export interface CacheHandlerPluginOptions {
  /**
   * The response headers to set from the root procedure's cache activity;
   * only listed headers are set. `orpc-cache-tag` carries the tags the
   * response depends on and `orpc-cache-tag-invalidation` the tags
   * revalidated by the request, for client-side revalidation. `cache-tag`
   * and `cache-control` are their standard HTTP counterparts for response
   * caches in front, such as CDNs or Cloudflare Workers Caching: they are
   * only set on GET and HEAD responses and never override existing headers.
   *
   * @default []
   */
  headers?: readonly CacheHandlerPluginHeader[]
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

  constructor(options: CacheHandlerPluginOptions = {}) {
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

      const rootCache = pluginContext.caches.find(
        check => check.procedure === interceptorOptions.procedure && isDeepEqual(check.path, interceptorOptions.path),
      )
      const rootRevalidation = pluginContext.revalidations.find(
        check => check.procedure === interceptorOptions.procedure && isDeepEqual(check.path, interceptorOptions.path),
      )

      const method = interceptorOptions.request.method.toUpperCase()
      const isHttpCacheable = rootCache !== undefined && (method === 'GET' || method === 'HEAD')

      const headers: StandardHeaders = { ...response.headers }
      let changed = false

      if (this.headers.has(CACHE_TAG_HEADER) && rootCache?.tags.length) {
        headers[CACHE_TAG_HEADER] = encodeCacheTagHeader(rootCache.tags)
        changed = true
      }

      if (this.headers.has(CACHE_TAG_INVALIDATION_HEADER) && rootRevalidation?.tags.length) {
        headers[CACHE_TAG_INVALIDATION_HEADER] = encodeCacheTagHeader(rootRevalidation.tags)
        changed = true
      }

      if (this.headers.has('cache-tag') && isHttpCacheable && rootCache.tags.length && headers['cache-tag'] === undefined) {
        headers['cache-tag'] = encodeCacheTagHeader(rootCache.tags)
        changed = true
      }

      if (this.headers.has('cache-control') && isHttpCacheable && headers['cache-control'] === undefined) {
        /**
         * Entries without a ttl stay valid until revalidated, so front caches
         * hold them for a year and rely on tag purges.
         */
        const sMaxAge = rootCache.ttl !== undefined ? Math.ceil(rootCache.ttl / 1000) : 31536000
        const staleWhileRevalidate = rootCache.swr !== undefined && rootCache.swr > 0 ? `, stale-while-revalidate=${Math.ceil(rootCache.swr / 1000)}` : ''
        headers['cache-control'] = `public, s-maxage=${sMaxAge}${staleWhileRevalidate}`
        changed = true
      }

      return changed ? { ...response, headers } : response
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
