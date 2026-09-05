import type { CacheEntry, CacheRevalidateOptions, CacheSetOptions, CacheStore } from '@orpc/experimental-cache'
import { encodeCacheTag, toArray } from '@orpc/shared'
import * as workers from 'cloudflare:workers'

export interface experimental_WorkersCacheStoreOptions {
  /**
   * The Workers Caching purge surface, such as `ctx.cache`.
   *
   * @default cache from `cloudflare:workers`
   */
  cache?: CacheContext
}

/**
 * Purge-only cache store for Cloudflare Workers Caching. Responses are cached
 * in front of the Worker through `Cache-Control` and `Cache-Tag` headers (see
 * the `CacheHandlerPlugin` `headers` option), so `get` always misses and
 * `set` stores nothing; `revalidate` purges the tags through Workers
 * Caching.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class experimental_WorkersCacheStore implements CacheStore {
  private readonly cache: CacheContext

  constructor(options: experimental_WorkersCacheStoreOptions = {}) {
    this.cache = options.cache ?? workers.cache
  }

  async get(_key: unknown): Promise<CacheEntry | undefined> {
    return undefined
  }

  async set(_key: unknown, _output: unknown, _options?: CacheSetOptions): Promise<void> {
    // Storage happens at the response layer, driven by the reflected headers.
  }

  async revalidate({ tags }: CacheRevalidateOptions): Promise<void> {
    const result = await this.cache.purge({
      // Tags must match the reflected Cache-Tag header, so each one is encoded the same way.
      tags: tags.map(tag => encodeCacheTag(tag)),
    })

    if (!result.success) {
      const messages = toArray(result.errors).map(error => error.message).filter(Boolean).join('; ')
      throw new Error(`experimental_WorkersCacheStore failed to purge tags${messages ? `: ${messages}` : ''}`)
    }
  }
}
