import type { CacheEntry, CacheFetchOptions, CacheRevalidateOptions } from '../types'
import type { BaseKeyValueCacheStoreOptions } from './base-key-value'
import { nowInSeconds } from '@orpc/shared'
import { resolveCacheExpiry } from '../utils'
import { BaseKeyValueCacheStore } from './base-key-value'

export type MemoryCacheStoreOptions = BaseKeyValueCacheStoreOptions

interface MemoryCacheStoreEntry {
  output: unknown
  /**
   * The tags, and the version counter each had when the fill started, index-aligned.
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
 * revalidated entries are removed lazily on the next `fetch` of their key.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class MemoryCacheStore extends BaseKeyValueCacheStore {
  private readonly entries = new Map<string, MemoryCacheStoreEntry>()
  private readonly tagVersions = new Map<string, number>()

  constructor(options: MemoryCacheStoreOptions = {}) {
    super(options)
  }

  async revalidate({ tags }: CacheRevalidateOptions): Promise<void> {
    for (const tag of tags) {
      this.tagVersions.set(tag, (this.tagVersions.get(tag) ?? 0) + 1)
    }
  }

  protected read(encodedKey: string): CacheEntry | undefined {
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
      evictAt: entry.evictAt,
    }
  }

  protected async fill(encodedKey: string, fill: () => Promise<unknown>, options: CacheFetchOptions): Promise<CacheEntry> {
    const tags = options.tags
    const tagVersions = tags?.map(tag => this.tagVersions.get(tag) ?? 0)
    const output = await fill()
    const { expiresAt, evictAt } = resolveCacheExpiry(options)

    this.entries.set(encodedKey, { output, tags, tagVersions, expiresAt, evictAt })

    return { output, tags, expiresAt, evictAt }
  }
}
