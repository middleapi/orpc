import type { RPCJsonSerialization } from '@orpc/client'
import type { RuntimeCache } from '@vercel/functions'
import type { CacheEntry, CacheFetchOptions, CacheRevalidateOptions } from '../types'
import type { BaseKeyValueCacheStoreOptions } from './base-key-value'
import { nowInSeconds } from '@orpc/shared'
import { getCache } from '@vercel/functions'
import { resolveCacheExpiry } from '../utils'
import { BaseKeyValueCacheStore } from './base-key-value'

interface VercelCacheStoreEnvelope {
  output: RPCJsonSerialization
  tags?: readonly string[]
  expiresAt?: number | undefined
  evictAt?: number | undefined
}

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
 * cache. Concurrent callers of one key are coalesced within the process,
 * since the Runtime Cache has no atomic primitive; for the same reason, a
 * revalidation landing while a fill runs is not detected.
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
    const envelope = await this.cache.get(encodedKey) as VercelCacheStoreEnvelope | null | undefined

    if (envelope == null) {
      return undefined
    }

    if (envelope.evictAt !== undefined && nowInSeconds() >= envelope.evictAt) {
      await this.cache.delete(encodedKey)
      return undefined
    }

    return {
      output: this.serializer.deserialize(envelope.output),
      tags: envelope.tags,
      expiresAt: envelope.expiresAt,
      evictAt: envelope.evictAt,
    }
  }

  protected async fill(encodedKey: string, fill: () => Promise<unknown>, options: CacheFetchOptions): Promise<CacheEntry> {
    const output = await fill()
    const tags = options.tags
    const { expiresAt, evictAt, retention } = resolveCacheExpiry(options)
    const { json, meta } = this.serializer.serialize(output)

    const envelope: VercelCacheStoreEnvelope = {
      output: { json, meta },
      tags,
      expiresAt,
      evictAt,
    }

    await this.cache.set(encodedKey, envelope, {
      ...(tags?.length ? { tags: [...tags] } : {}),
      ...(retention !== undefined ? { ttl: retention } : {}),
    })

    return { output, tags, expiresAt, evictAt }
  }
}
