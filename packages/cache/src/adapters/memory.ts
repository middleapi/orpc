import type { Public } from '@orpc/shared'
import type { CacheEntry, CacheRevalidateOptions, CacheSetOptions, CacheStore } from '../types'
import { RPCJsonSerializer } from '@orpc/client'
import { MemoryLock, nowInSeconds } from '@orpc/shared'
import { encodeCacheKey } from '../utils'

export interface MemoryCacheStoreOptions {
  /**
   * Serializer used to encode non-string keys.
   *
   * @default RPCJsonSerializer
   */
  serializer?: undefined | Public<RPCJsonSerializer>
}

interface MemoryCacheStoreEntry {
  output: unknown
  /**
   * The tags, and the version counter each had at set time, index-aligned.
   * Both are absent together when the entry has no tags.
   */
  tags?: readonly string[]
  tagVersions?: readonly number[]
  expiresAt: number | undefined
  evictAt: number | undefined
}

/**
 * In-memory cache store with tag-based invalidation, intended for
 * development, testing, and single-instance deployments. Expired and
 * revalidated entries are removed lazily on the next `get` of their key.
 * Locks are held within the process.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, MemoryCacheStoreEntry>()
  private readonly tagVersions = new Map<string, number>()
  private readonly serializer: Public<RPCJsonSerializer>
  private readonly memoryLock = new MemoryLock()

  constructor(options: MemoryCacheStoreOptions = {}) {
    this.serializer = options.serializer ?? new RPCJsonSerializer()
  }

  async get(key: unknown): Promise<CacheEntry | undefined> {
    const encodedKey = encodeCacheKey(key, this.serializer)
    const entry = this.entries.get(encodedKey)

    if (!entry) {
      return undefined
    }

    if (entry.evictAt !== undefined && nowInSeconds() >= entry.evictAt) {
      this.entries.delete(encodedKey)
      return undefined
    }

    const revalidated = entry.tags?.some(
      (tag, index) => (this.tagVersions.get(tag) ?? 0) !== entry.tagVersions?.[index],
    )

    if (revalidated) {
      this.entries.delete(encodedKey)
      return undefined
    }

    return {
      output: entry.output,
      tags: entry.tags,
      expiresAt: entry.expiresAt,
    }
  }

  async set(key: unknown, output: unknown, options?: CacheSetOptions): Promise<void> {
    const tags = options?.tags
    const expiresAt = options?.ttl !== undefined ? nowInSeconds() + options.ttl : undefined
    const evictAt = expiresAt !== undefined ? expiresAt + (options?.swr ?? 0) : undefined

    this.entries.set(encodeCacheKey(key, this.serializer), {
      output,
      tags,
      tagVersions: tags?.map(tag => this.tagVersions.get(tag) ?? 0),
      expiresAt,
      evictAt,
    })
  }

  async revalidate({ tags }: CacheRevalidateOptions): Promise<void> {
    for (const tag of tags) {
      this.tagVersions.set(tag, (this.tagVersions.get(tag) ?? 0) + 1)
    }
  }

  async lock<T>(key: unknown, fn: (waited: boolean) => Promise<T>): Promise<T> {
    return this.memoryLock.run(encodeCacheKey(key, this.serializer), fn)
  }
}
