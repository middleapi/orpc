import type { RuntimeCache } from '@vercel/functions'
import type { CacheEntry, CacheSetOptions, CacheStore } from '../types'
import type { CacheOutputSerializer } from './output-serializer'
import { toArray } from '@orpc/shared'
import { getCache } from '@vercel/functions'
import { createRpcJsonOutputSerializer } from './output-serializer'

export type VercelCacheStoreSerializer = CacheOutputSerializer

interface VercelCacheStoreEnvelope {
  /**
   * The cached output, encoded with the store's serializer.
   */
  output: string
  tags: readonly string[]
  expiresAt?: number | undefined
  evictAt?: number | undefined
}

export interface VercelCacheStoreOptions {
  /**
   * The Vercel Runtime Cache to use.
   *
   * @default getCache()
   */
  cache?: RuntimeCache

  /**
   * Serializer for cached outputs.
   *
   * @default an RPCJsonSerializer-backed serializer preserving Date, BigInt, Set, Map, URL, RegExp, NaN, and undefined values
   */
  serializer?: VercelCacheStoreSerializer
}

/**
 * Cache store adapter for the Vercel Runtime Cache. Tags are expired
 * natively via `expireTag`, and entries are retained for `ttl + swr`
 * rounded up to whole seconds. Outside Vercel, the default `getCache()`
 * falls back to an in-memory cache.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class VercelCacheStore implements CacheStore {
  private readonly cache: RuntimeCache
  private readonly serializer: VercelCacheStoreSerializer

  constructor(options: VercelCacheStoreOptions = {}) {
    this.cache = options.cache ?? getCache()
    this.serializer = options.serializer ?? createRpcJsonOutputSerializer('VercelCacheStore')
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    const envelope = await this.cache.get(key) as VercelCacheStoreEnvelope | null | undefined

    if (envelope == null) {
      return undefined
    }

    if (envelope.evictAt !== undefined && Date.now() >= envelope.evictAt) {
      await this.cache.delete(key)
      return undefined
    }

    return {
      output: this.serializer.parse(envelope.output),
      tags: envelope.tags,
      expiresAt: envelope.expiresAt,
    }
  }

  async set(key: string, output: unknown, options?: CacheSetOptions): Promise<void> {
    const tags = options?.tags ?? []
    const retention = options?.ttl !== undefined ? options.ttl + (options.swr ?? 0) : undefined
    const expiresAt = options?.ttl !== undefined ? Date.now() + options.ttl : undefined
    const evictAt = retention !== undefined ? Date.now() + retention : undefined

    const envelope: VercelCacheStoreEnvelope = {
      output: this.serializer.stringify(output),
      tags,
      expiresAt,
      evictAt,
    }

    await this.cache.set(key, envelope, {
      ...(tags.length ? { tags: [...tags] } : {}),
      ...(retention !== undefined ? { ttl: Math.ceil(retention / 1000) } : {}),
    })
  }

  async revalidateTag(tag: string | readonly string[]): Promise<void> {
    const tags = toArray(tag)

    if (!tags.length) {
      return
    }

    await this.cache.expireTag([...tags])
  }
}
