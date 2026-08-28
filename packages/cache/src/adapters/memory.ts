import type { RPCJsonSerializer } from '@orpc/client'
import type { Public } from '@orpc/shared'
import type { CacheEntry, CacheSetOptions, CacheStore } from '../types'
import { toArray } from '@orpc/shared'
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
  tags: readonly string[]
  /**
   * Tag version counters snapshotted at set time, index-aligned with `tags`.
   */
  tagVersions: number[]
  expiresAt: number | undefined
  evictAt: number | undefined
}

/**
 * In-memory cache store with tag-based invalidation, intended for
 * development, testing, and single-instance deployments. Expired and
 * revalidated entries are removed lazily on the next `get` of their key.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, MemoryCacheStoreEntry>()
  private readonly tagVersions = new Map<string, number>()
  private readonly serializer: Public<RPCJsonSerializer> | undefined

  constructor(options: MemoryCacheStoreOptions = {}) {
    this.serializer = options.serializer
  }

  async get(key: unknown): Promise<CacheEntry | undefined> {
    const entry = this.entries.get(encodeCacheKey(key, this.serializer))

    if (!entry) {
      return undefined
    }

    if (entry.evictAt !== undefined && Date.now() >= entry.evictAt) {
      this.entries.delete(encodeCacheKey(key, this.serializer))
      return undefined
    }

    const revalidated = entry.tags.some(
      (tag, index) => (this.tagVersions.get(tag) ?? 0) !== entry.tagVersions[index],
    )

    if (revalidated) {
      this.entries.delete(encodeCacheKey(key, this.serializer))
      return undefined
    }

    return {
      output: entry.output,
      tags: entry.tags,
      expiresAt: entry.expiresAt,
    }
  }

  async set(key: unknown, output: unknown, options?: CacheSetOptions): Promise<void> {
    const tags = options?.tags ?? []
    const expiresAt = options?.ttl !== undefined ? Date.now() + options.ttl : undefined
    const evictAt = expiresAt !== undefined ? expiresAt + (options?.swr ?? 0) : undefined

    this.entries.set(encodeCacheKey(key, this.serializer), {
      output,
      tags,
      tagVersions: tags.map(tag => this.tagVersions.get(tag) ?? 0),
      expiresAt,
      evictAt,
    })
  }

  async revalidateTag(tag: string | readonly string[]): Promise<void> {
    for (const t of toArray(tag)) {
      this.tagVersions.set(t, (this.tagVersions.get(t) ?? 0) + 1)
    }
  }
}
