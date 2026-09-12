import type { CacheEntry, CacheGetOrSetOptions, CacheRevalidateOptions, CacheStore } from './types'

export interface TieredCacheStoreTier {
  store: CacheStore

  /**
   * Caps `ttl` in this tier, so a front tier refills from the next one
   * before the entry behind it can change.
   */
  ttl?: number

  /**
   * Caps `swr` in this tier.
   */
  swr?: number
}

/**
 * Cache store layering several stores front to back, such as a memory store
 * in front of a Redis one. A miss in one tier fills from the next, so only
 * the last tier runs the fill, and a revalidation reaches every tier. Each
 * tier measures `ttl` from when it stored its copy, so cap it on front tiers
 * to bound how long they may outlive the entry behind them.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#tiered-store | Cache Helpers - Tiered Store}
 */
export class TieredCacheStore implements CacheStore {
  constructor(private readonly tiers: readonly [TieredCacheStoreTier, ...TieredCacheStoreTier[]]) {}

  getOrSet(key: unknown, fill: () => Promise<unknown>, options: CacheGetOrSetOptions = {}): Promise<CacheEntry> {
    return this.getOrSetFrom(0, key, fill, options)
  }

  async revalidate(options: CacheRevalidateOptions): Promise<void> {
    await Promise.all(this.tiers.map(({ store }) => store.revalidate(options)))
  }

  private getOrSetFrom(index: number, key: unknown, fill: () => Promise<unknown>, options: CacheGetOrSetOptions): Promise<CacheEntry> {
    const { store, ttl, swr } = this.tiers[index]!
    const next = index + 1 < this.tiers.length
      ? async () => (await this.getOrSetFrom(index + 1, key, fill, options)).output
      : fill

    return store.getOrSet(key, next, {
      ...options,
      ttl: cap(options.ttl, ttl),
      swr: cap(options.swr, swr),
    })
  }
}

function cap(value: number | undefined, limit: number | undefined): number | undefined {
  return value === undefined ? limit : limit === undefined ? value : Math.min(value, limit)
}
