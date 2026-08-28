import type { Public } from '@orpc/shared'
import type { CacheEntry, CacheSetOptions, CacheStore } from '../types'
import { RPCSerializer } from '@orpc/client'
import { deepSortKeys, isAsyncIteratorObject, stringifyJSON, toArray } from '@orpc/shared'

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

export interface MemoryCacheStoreOptions {
  /**
   * Serializer used to encode non-string keys.
   *
   * @default RPCSerializer
   */
  serializer?: undefined | Public<RPCSerializer>
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
  private readonly serializer: Public<RPCSerializer>

  constructor(options: MemoryCacheStoreOptions = {}) {
    this.serializer = options.serializer ?? new RPCSerializer()
  }

  async get(key: unknown): Promise<CacheEntry | undefined> {
    const entry = this.entries.get(this.encodeKey(key))

    if (!entry) {
      return undefined
    }

    if (entry.evictAt !== undefined && Date.now() >= entry.evictAt) {
      this.entries.delete(this.encodeKey(key))
      return undefined
    }

    const revalidated = entry.tags.some(
      (tag, index) => (this.tagVersions.get(tag) ?? 0) !== entry.tagVersions[index],
    )

    if (revalidated) {
      this.entries.delete(this.encodeKey(key))
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

    this.entries.set(this.encodeKey(key), {
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

  private encodeKey(key: unknown): string {
    if (typeof key === 'string') {
      return key
    }

    const serialized = this.serializer.serialize(deepSortKeys(key))

    if (serialized instanceof Blob || serialized instanceof FormData || serialized instanceof ReadableStream || isAsyncIteratorObject(serialized)) {
      throw new TypeError('Cache keys must be serializable to JSON, provide an explicit string key instead')
    }

    return `${stringifyJSON(serialized)}`
  }
}
