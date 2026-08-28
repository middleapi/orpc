import type { CacheEntry, CacheSetOptions, CacheStore } from '@orpc/cache'
import { encodeCacheTagHeader } from '@orpc/cache'
import { toArray } from '@orpc/shared'

/**
 * The purge surface of Cloudflare Workers Caching, satisfied by both
 * `ctx.cache` and `cache` imported from `cloudflare:workers`.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export interface WorkersCachePurger {
  purge(options: { tags: string[] }): Promise<{ success: boolean, errors?: { code?: number, message?: string }[] }>
}

/**
 * Purge-only cache store for Cloudflare Workers Caching. Responses are cached
 * in front of the Worker through `Cache-Control` and `Cache-Tag` headers (see
 * the `CacheHandlerPlugin` `httpCacheHeaders` option), so `get` always misses
 * and `set` stores nothing; `revalidateTag` purges the tags through Workers
 * Caching.
 *
 * @remarks
 * **Note**: Purges are scoped to the calling entrypoint, tags are matched
 * case-insensitively, and purge calls always use the Free tier rate limits
 * regardless of your plan.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class WorkersCacheStore implements CacheStore {
  constructor(
    private readonly cache: WorkersCachePurger,
  ) {}

  async get(_key: string): Promise<CacheEntry | undefined> {
    return undefined
  }

  async set(_key: string, _output: unknown, _options?: CacheSetOptions): Promise<void> {
    // Storage happens at the response layer, driven by the reflected headers.
  }

  async revalidateTag(tag: string | readonly string[]): Promise<void> {
    const tags = toArray(tag)

    if (!tags.length) {
      return
    }

    const result = await this.cache.purge({
      // Tags must match the reflected Cache-Tag header, so each one is encoded the same way.
      tags: tags.map(t => encodeCacheTagHeader([t])),
    })

    if (!result.success) {
      const messages = toArray(result.errors).map(error => error.message).filter(Boolean).join('; ')
      throw new Error(`WorkersCacheStore failed to purge tags${messages ? `: ${messages}` : ''}`)
    }
  }
}
