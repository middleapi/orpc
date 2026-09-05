import type { Public } from '@orpc/shared'
import type { RuntimeCache } from '@vercel/functions'
import type { CacheEntry, CacheRevalidateOptions, CacheSetOptions, CacheStore } from '../types'
import { RPCJsonSerializer, RPCSerializer } from '@orpc/client'
import { MemoryLock, nowInSeconds } from '@orpc/shared'
import { getCache } from '@vercel/functions'
import { encodeCacheKey } from '../utils'

interface VercelCacheStoreEnvelope {
  /**
   * The cached output, encoded with the store's serializer.
   */
  output: unknown
  tags?: readonly string[]
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
   * @default RPCSerializer
   */
  serializer?: undefined | Public<RPCSerializer>
}

/**
 * Cache store adapter for the Vercel Runtime Cache. Tags are expired
 * natively via `expireTag`, and entries are retained for `ttl + swr`.
 * Outside Vercel, the default `getCache()` falls back to an in-memory
 * cache. Locks are held within the process, since the Runtime Cache has no
 * atomic primitive.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class VercelCacheStore implements CacheStore {
  private readonly cache: RuntimeCache
  private readonly serializer: Public<RPCSerializer>

  /**
   * Key encoding has no serializer option, so one is built here rather than
   * per call by {@link encodeCacheKey}.
   */
  private readonly keySerializer = new RPCJsonSerializer()
  private readonly memoryLock = new MemoryLock()

  constructor(options: VercelCacheStoreOptions = {}) {
    this.cache = options.cache ?? getCache()
    this.serializer = options.serializer ?? new RPCSerializer()
  }

  async get(key: unknown): Promise<CacheEntry | undefined> {
    const encodedKey = encodeCacheKey(key, this.keySerializer)
    const envelope = await this.cache.get(encodedKey) as VercelCacheStoreEnvelope | null | undefined

    if (envelope == null) {
      return undefined
    }

    if (envelope.evictAt !== undefined && nowInSeconds() >= envelope.evictAt) {
      await this.cache.delete(encodedKey)
      return undefined
    }

    return {
      output: this.serializer.deserialize(envelope.output as any),
      tags: envelope.tags,
      expiresAt: envelope.expiresAt,
    }
  }

  async set(key: unknown, output: unknown, options?: CacheSetOptions): Promise<void> {
    const serialized = this.serializer.serialize(output)

    const tags = options?.tags
    const retention = options?.ttl !== undefined ? options.ttl + (options.swr ?? 0) : undefined
    const expiresAt = options?.ttl !== undefined ? nowInSeconds() + options.ttl : undefined
    const evictAt = retention !== undefined ? nowInSeconds() + retention : undefined

    const envelope: VercelCacheStoreEnvelope = {
      output: serialized,
      tags,
      expiresAt,
      evictAt,
    }

    await this.cache.set(encodeCacheKey(key, this.keySerializer), envelope, {
      ...(tags?.length ? { tags: [...tags] } : {}),
      ...(retention !== undefined ? { ttl: retention } : {}),
    })
  }

  async revalidate({ tags }: CacheRevalidateOptions): Promise<void> {
    await this.cache.expireTag([...tags])
  }

  async lock<T>(key: unknown, fn: (waited: boolean) => Promise<T>): Promise<T> {
    return this.memoryLock.run(encodeCacheKey(key, this.keySerializer), fn)
  }
}
