import type { CacheEntry, CacheGetOrSetOptions, CacheRevalidateOptions } from '../types'
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
 * revalidated entries are dropped when their key is read again, and otherwise
 * swept on the next write once an eviction time or a revalidation has passed.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class MemoryCacheStore extends BaseKeyValueCacheStore {
  private readonly entries = new Map<string, MemoryCacheStoreEntry>()
  private readonly tagVersions = new Map<string, number>()
  private nextSweepAt = Infinity

  constructor(options: MemoryCacheStoreOptions = {}) {
    super(options)
  }

  async revalidate({ tags }: CacheRevalidateOptions): Promise<void> {
    for (const tag of tags) {
      this.tagVersions.set(tag, (this.tagVersions.get(tag) ?? 0) + 1)
    }

    this.nextSweepAt = 0
  }

  protected read(encodedKey: string): CacheEntry | undefined {
    const entry = this.entries.get(encodedKey)

    if (!entry) {
      return undefined
    }

    if (this.shouldEvict(entry, nowInSeconds())) {
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

  protected async fill(encodedKey: string, fill: () => Promise<unknown>, options: CacheGetOrSetOptions): Promise<CacheEntry> {
    const tags = options.tags
    const tagVersions = tags?.map(tag => this.tagVersions.get(tag) ?? 0)
    const output = await fill()
    const { expiresAt, evictAt } = resolveCacheExpiry(options)

    this.sweep()
    this.entries.set(encodedKey, { output, tags, tagVersions, expiresAt, evictAt })

    if (evictAt !== undefined) {
      this.nextSweepAt = Math.min(this.nextSweepAt, evictAt)
    }

    return { output, tags, expiresAt, evictAt }
  }

  private shouldEvict(entry: MemoryCacheStoreEntry, now: number): boolean {
    return (entry.evictAt !== undefined && now >= entry.evictAt)
      || (entry.tags?.some((tag, index) => (this.tagVersions.get(tag) ?? 0) !== entry.tagVersions?.[index]) ?? false)
  }

  /**
   * Drops every entry due for eviction once the earliest eviction time or a
   * revalidation has passed, so entries never read again still leave the store.
   */
  private sweep(): void {
    const now = nowInSeconds()

    if (now < this.nextSweepAt) {
      return
    }

    this.nextSweepAt = Infinity

    for (const [encodedKey, entry] of this.entries) {
      if (this.shouldEvict(entry, now)) {
        this.entries.delete(encodedKey)
      }
      else if (entry.evictAt !== undefined) {
        this.nextSweepAt = Math.min(this.nextSweepAt, entry.evictAt)
      }
    }
  }
}
