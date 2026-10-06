import type { ClientContext } from '@orpc/client'
import type { StandardLinkOptions, StandardLinkPlugin, StandardLinkTransportInterceptor } from '@orpc/client/standard'
import type { CacheHandlerPluginHeader } from './handler-plugin'
import { decodeCacheTagHeader, toArray } from '@orpc/shared'

/**
 * The client context key under which callers receive the cache tags of a call.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#server-side-clients | Cache Helpers - Server-Side Clients}
 */
export const CACHE_LINK_PLUGIN_CONTEXT_SYMBOL: unique symbol = Symbol.for('ORPC_CACHE_LINK_PLUGIN_CONTEXT')

/**
 * The client context through which callers receive the cache tags of a call.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#server-side-clients | Cache Helpers - Server-Side Clients}
 */
export interface CacheLinkPluginContext {
  /**
   * Filled with the cache tags of the call's response by `CacheLinkPlugin`,
   * or by `cacheRouterClientInterceptor` for router clients, and left unset
   * when neither handles the call. Readers reuse one already in the context
   * instead of replacing it, so every reader of the call sees the tags.
   */
  [CACHE_LINK_PLUGIN_CONTEXT_SYMBOL]?: {
    /**
     * The tags the response depends on, from `orpc-cache-tag`.
     */
    tags?: string[]

    /**
     * The tags the request revalidated, from `orpc-cache-tag-invalidation`.
     */
    revalidatedTags?: string[]
  }
}

/**
 * Reads the `orpc-cache-tag` and `orpc-cache-tag-invalidation` response
 * headers set by the cache handler plugin into the calling client context,
 * for client caches to track and revalidate tagged data. Does nothing for
 * calls whose context does not ask for them.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#link-plugin | Cache Helpers - Link Plugin}
 */
export class CacheLinkPlugin<T extends ClientContext> implements StandardLinkPlugin<T> {
  name = '~cache'

  /**
   * Batched and deduplicated calls share one transport request, so the
   * headers must be read before they merge, while each call still holds its
   * own context.
   */
  before = ['~batch', '~dedupe']

  init(options: StandardLinkOptions<T>): StandardLinkOptions<T> {
    const interceptor: StandardLinkTransportInterceptor<T> = async (interceptorOptions) => {
      const pluginContext = (interceptorOptions.context as CacheLinkPluginContext)[CACHE_LINK_PLUGIN_CONTEXT_SYMBOL]

      const response = await interceptorOptions.next()

      if (pluginContext !== undefined) {
        const decode = (header: CacheHandlerPluginHeader) => toArray(response.headers[header]).flatMap(decodeCacheTagHeader)

        pluginContext.tags = decode('orpc-cache-tag')
        pluginContext.revalidatedTags = decode('orpc-cache-tag-invalidation')
      }

      return response
    }

    return {
      ...options,
      transportInterceptors: [
        ...toArray(options.transportInterceptors),
        interceptor,
      ],
    }
  }
}
