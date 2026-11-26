import type { CacheEntry, CacheGetOrSetOptions, CacheRevalidateOptions } from '../types'
import { createCacheEntry } from '../utils'
import type { BaseKeyValueCacheStoreOptions } from './base-key-value'
import { BaseKeyValueCacheStore } from './base-key-value'

export type MemoryCacheStoreOptions = BaseKeyValueCacheStoreOptions

interface MemoryCacheStoreEntry {
  entry: CacheEntry
  /**
   * The version each tag had when the fill started, index-aligned with the entry's tags.
   */
  tagVersions: readonly number[]
}

/**
 * Each sweep scans every entry, so they run at most this often, in milliseconds.
 */
const MIN_SWEEP_INTERVAL = 1000

/**
 * In-memory cache store with tag-based invalidation, intended for
 * development, testing, and single-instance deployments. Expired and
 * revalidated entries are dropped when their key is read again, and otherwise
 * swept on a later write.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class MemoryCacheStore extends BaseKeyValueCacheStore {
  private readonly entries = new Map<string, MemoryCacheStoreEntry>()
  private readonly tagVersions = new Map<string, number>()
  private nextSweepAt = Infinity
  private lastSweepAt = -Infinity

  async revalidate({ tags }: CacheRevalidateOptions): Promise<void> {
    for (const tag of tags) {
      this.tagVersions.set(tag, (this.tagVersions.get(tag) ?? 0) + 1)
    }

    this.nextSweepAt = 0
  }

  protected read(encodedKey: string): CacheEntry | undefined {
    const stored = this.entries.get(encodedKey)

    if (!stored) {
      return undefined
    }

    if (this.shouldEvict(stored, Date.now())) {
      this.entries.delete(encodedKey)
      return undefined
    }

    return stored.entry
  }

  protected async fill(
    encodedKey: string,
    compute: () => Promise<unknown>,
    options: CacheGetOrSetOptions,
  ): Promise<CacheEntry> {
    const tagVersions = (options.tags ?? []).map((tag) => this.tagVersions.get(tag) ?? 0)
    const { entry } = createCacheEntry(await compute(), options)

    this.sweep()
    this.entries.set(encodedKey, { entry, tagVersions })
    this.scheduleSweep(entry)

    return entry
  }

  private shouldEvict({ entry, tagVersions }: MemoryCacheStoreEntry, now: number): boolean {
    return (
      (entry.evictAt !== undefined && now >= entry.evictAt) ||
      !!entry.tags?.some((tag, index) => (this.tagVersions.get(tag) ?? 0) !== tagVersions[index])
    )
  }

  private scheduleSweep({ evictAt }: CacheEntry): void {
    if (evictAt !== undefined) {
      this.nextSweepAt = Math.min(
        this.nextSweepAt,
        Math.max(evictAt, this.lastSweepAt + MIN_SWEEP_INTERVAL),
      )
    }
  }

  /**
   * Drops entries due for eviction, so ones never read again still leave the store.
   */
  private sweep(): void {
    const now = Date.now()

    if (now < this.nextSweepAt) {
      return
    }

    this.nextSweepAt = Infinity
    this.lastSweepAt = now

    for (const [encodedKey, stored] of this.entries) {
      if (this.shouldEvict(stored, now)) {
        this.entries.delete(encodedKey)
      } else {
        this.scheduleSweep(stored.entry)
      }
    }
  }
}
