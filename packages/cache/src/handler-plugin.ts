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

export interface CacheHandlerPluginOptions {
  /**
   * Also reflects the root cache check into standard HTTP caching headers on
   * GET and HEAD responses: `Cache-Tag` with the same encoded tags, and
   * `Cache-Control: public, s-maxage=...` (plus `stale-while-revalidate` when
   * `swr` is set) derived from the check's freshness. Headers already present
   * on the response are never overridden. This lets response caches in front,
   * such as CDNs or Cloudflare Workers Caching, serve and purge whole responses.
   *
   * @default false
   */
  httpCacheHeaders?: boolean
}

/**
 * Reflects cache tags and revalidated tags into the `orpc-cache-tag` and
 * `orpc-cache-tag-invalidation` response headers when used with the `cache` and
 * `revalidate` middlewares. Only the first check belonging to the procedure
 * the client called is reflected, so nested procedure calls never leak
 * their tags into the response.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#handler-plugin | Cache Helpers - Handler Plugin}
 */
export class CacheHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~cache'

  private readonly httpCacheHeaders: boolean

  constructor(options: CacheHandlerPluginOptions = {}) {
    this.httpCacheHeaders = options.httpCacheHeaders ?? false
  }

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
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
      const emitHttpHeaders = this.httpCacheHeaders && rootCache !== undefined && (method === 'GET' || method === 'HEAD')

      if (!rootCache?.tags.length && !rootRevalidation?.tags.length && !emitHttpHeaders) {
        return response
      }

      const headers: StandardHeaders = { ...response.headers }

      if (rootCache?.tags.length) {
        headers[CACHE_TAG_HEADER] = encodeCacheTagHeader(rootCache.tags)
      }

      if (rootRevalidation?.tags.length) {
        headers[CACHE_TAG_INVALIDATION_HEADER] = encodeCacheTagHeader(rootRevalidation.tags)
      }

      if (emitHttpHeaders) {
        if (headers['cache-tag'] === undefined && rootCache.tags.length) {
          headers['cache-tag'] = encodeCacheTagHeader(rootCache.tags)
        }

        if (headers['cache-control'] === undefined) {
          /**
           * Entries without a ttl stay valid until revalidated, so front caches
           * hold them for a year and rely on tag purges.
           */
          const sMaxAge = rootCache.ttl !== undefined ? Math.ceil(rootCache.ttl / 1000) : 31536000
          const staleWhileRevalidate = rootCache.swr !== undefined && rootCache.swr > 0 ? `, stale-while-revalidate=${Math.ceil(rootCache.swr / 1000)}` : ''
          headers['cache-control'] = `public, s-maxage=${sMaxAge}${staleWhileRevalidate}`
        }
      }

      return { ...response, headers }
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
