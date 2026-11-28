import { stringifyJSON } from '@orpc/shared'

import type { CacheEntry, CacheGetOrSetOptions, CacheRevalidateOptions } from '../types'
import { isCacheEntryEvicted } from '../utils'
import type { BaseKeyValueCacheStoreOptions, CacheEnvelope } from './base-key-value'
import { BaseKeyValueCacheStore } from './base-key-value'

export type MemoryCacheStoreOptions = BaseKeyValueCacheStoreOptions

interface MemoryCacheStoreEntry extends Omit<CacheEnvelope, 'output'> {
  /**
   * Kept as a JSON string and parsed on each read, so every hit gets its own copy.
   */
  output: string
  /**
   * The version each tag had when the fill started, index-aligned with the tags.
   */
  tagVersions: readonly number[]
}

/**
 * How often a write may sweep the store, in milliseconds. A sweep scans every entry.
 */
const SWEEP_INTERVAL = 1000

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
  private lastSweepAt = -Infinity

  async revalidate({ tags }: CacheRevalidateOptions): Promise<void> {
    for (const tag of tags) {
      this.tagVersions.set(tag, (this.tagVersions.get(tag) ?? 0) + 1)
    }
  }

  protected read(encodedKey: string): CacheEntry | undefined {
    const stored = this.entries.get(encodedKey)

    if (!stored) {
      return undefined
    }

    if (this.shouldEvict(stored)) {
      this.entries.delete(encodedKey)
      return undefined
    }

    return this.decode({ ...stored, output: JSON.parse(stored.output) })
  }

  protected async fill(
    encodedKey: string,
    compute: () => Promise<unknown>,
    options: CacheGetOrSetOptions,
  ): Promise<CacheEntry> {
    const tagVersions = (options.tags ?? []).map((tag) => this.tagVersions.get(tag) ?? 0)
    const { envelope, entry } = this.encode(await compute(), options)

    this.sweep()
    this.entries.set(encodedKey, {
      ...envelope,
      output: stringifyJSON(envelope.output),
      tagVersions,
    })

    return entry
  }

  private shouldEvict(stored: MemoryCacheStoreEntry): boolean {
    return (
      isCacheEntryEvicted(stored) ||
      !!stored.tags?.some(
        (tag, index) => (this.tagVersions.get(tag) ?? 0) !== stored.tagVersions[index],
      )
    )
  }

  /**
   * Drops entries due for eviction, so ones never read again still leave the store.
   */
  private sweep(): void {
    const now = Date.now()

    if (now - this.lastSweepAt < SWEEP_INTERVAL) {
      return
    }

    this.lastSweepAt = now

    for (const [encodedKey, stored] of this.entries) {
      if (this.shouldEvict(stored)) {
        this.entries.delete(encodedKey)
      }
    }
  }
}
