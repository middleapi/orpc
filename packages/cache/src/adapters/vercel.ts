import type { RuntimeCache } from '@vercel/functions'
import type { CacheEntry, CacheGetOrSetOptions, CacheRevalidateOptions } from '../types'
import type { BaseKeyValueCacheStoreOptions, CacheEnvelope } from './base-key-value'
import { getCache } from '@vercel/functions'
import { BaseKeyValueCacheStore } from './base-key-value'

export interface VercelCacheStoreOptions extends BaseKeyValueCacheStoreOptions {
  /**
   * The Vercel Runtime Cache to use.
   *
   * @default getCache()
   */
  cache?: RuntimeCache
}

/**
 * Cache store adapter for the Vercel Runtime Cache. Tags are expired
 * natively via `expireTag`, and entries are retained for `ttl + swr`.
 * Outside Vercel, the default `getCache()` falls back to an in-memory
 * cache. A revalidation landing while a fill runs is not detected, since
 * the Runtime Cache has no atomic primitive.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class VercelCacheStore extends BaseKeyValueCacheStore {
  private readonly cache: RuntimeCache

  constructor(options: VercelCacheStoreOptions = {}) {
    super(options)
    this.cache = options.cache ?? getCache()
  }

  async revalidate({ tags }: CacheRevalidateOptions): Promise<void> {
    await this.cache.expireTag([...tags])
  }

  protected async read(encodedKey: string): Promise<CacheEntry | undefined> {
    const envelope = await this.cache.get(encodedKey) as CacheEnvelope | null | undefined

    return envelope == null ? undefined : this.decode(envelope)
  }

  protected async fill(encodedKey: string, compute: () => Promise<unknown>, options: CacheGetOrSetOptions): Promise<CacheEntry> {
    const { envelope, entry, retention } = this.encode(await compute(), options)

    await this.cache.set(encodedKey, envelope, {
      ...(envelope.tags ? { tags: [...envelope.tags] } : {}),
      ...(retention !== undefined ? { ttl: Math.ceil(retention / 1000) } : {}),
    })

    return entry
  }
}
