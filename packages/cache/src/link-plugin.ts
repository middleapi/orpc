import type { ClientContext } from '@orpc/client'
import type {
  StandardLinkOptions,
  StandardLinkPlugin,
  StandardLinkTransportInterceptor,
} from '@orpc/client/standard'
import { decodeCacheTagHeader, toArray } from '@orpc/shared'

import type { CacheHandlerPluginHeader } from './handler-plugin'

/**
 * The client context key under which callers receive the cache tags of a call.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#server-side-clients | Cache Helpers - Server-Side Clients}
 */
export const CACHE_LINK_PLUGIN_CONTEXT_SYMBOL: unique symbol = /* @__PURE__ */ Symbol.for(
  'ORPC_CACHE_LINK_PLUGIN_CONTEXT',
)

/**
 * The client context through which callers receive the cache tags of a call.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#server-side-clients | Cache Helpers - Server-Side Clients}
 */
export interface CacheLinkPluginContext {
  /**
   * Filled by `CacheLinkPlugin` or `cacheRouterClientInterceptor`, unset when
   * neither handles the call. Readers reuse an existing one instead of replacing it.
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
 * for client caches to track and revalidate tagged data.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#link-plugin | Cache Helpers - Link Plugin}
 */
export class CacheLinkPlugin<T extends ClientContext> implements StandardLinkPlugin<T> {
  readonly name = '~cache'

  /**
   * Batched and deduplicated calls share one transport request, so the
   * headers must be read before they merge, while each call still holds its
   * own context.
   */
  readonly before: readonly string[] = ['~batch', '~dedupe']

  init(options: StandardLinkOptions<T>): StandardLinkOptions<T> {
    return {
      ...options,
      transportInterceptors: [...toArray(options.transportInterceptors), readCacheTagHeaders],
    }
  }
}

const readCacheTagHeaders: StandardLinkTransportInterceptor<any> = async (options) => {
  const pluginContext = (options.context as CacheLinkPluginContext)[
    CACHE_LINK_PLUGIN_CONTEXT_SYMBOL
  ]

  const response = await options.next()

  if (pluginContext !== undefined) {
    const decode = (header: CacheHandlerPluginHeader) =>
      toArray(response.headers[header]).flatMap(decodeCacheTagHeader)

    pluginContext.tags = decode('orpc-cache-tag')
    pluginContext.revalidatedTags = decode('orpc-cache-tag-invalidation')
  }

  return response
}
