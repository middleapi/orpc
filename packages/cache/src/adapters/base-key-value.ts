import type { Promisable, Public } from '@orpc/shared'
import type { CacheEntry, CacheGetOrSetOptions, CacheRevalidateOptions, CacheStore } from '../types'
import { RPCJsonSerializer } from '@orpc/client'
import { encodeCacheKey, isCacheEntryStale } from '../utils'

export interface BaseKeyValueCacheStoreOptions {
  /**
   * Serializer for keys, and for cached outputs where the backend stores
   * them serialized.
   *
   * @default RPCJsonSerializer
   */
  serializer?: undefined | Public<RPCJsonSerializer>
}

/**
 * Cache store over a key-value backend without an atomic primitive, so
 * concurrent callers of one key are coalesced within the process. Subclasses
 * read entries by their encoded key and fill the missing ones.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export abstract class BaseKeyValueCacheStore implements CacheStore {
  private readonly pending = new Map<string, Promise<unknown>>()
  protected readonly serializer: Public<RPCJsonSerializer>

  constructor(options: BaseKeyValueCacheStoreOptions = {}) {
    this.serializer = options.serializer ?? new RPCJsonSerializer()
  }

  async getOrSet(key: unknown, fill: () => Promise<unknown>, options: CacheGetOrSetOptions = {}): Promise<CacheEntry> {
    const encodedKey = encodeCacheKey(key, this.serializer)
    const entry = await this.read(encodedKey)

    if (entry === undefined) {
      return this.coalesce(encodedKey, async (waited) => {
        const current = waited ? await this.read(encodedKey) : undefined
        return current ?? this.fill(encodedKey, fill, options)
      })
    }

    if (isCacheEntryStale(entry)) {
      const refresh = this.coalesce(encodedKey, async (waited) => {
        const current = waited ? await this.read(encodedKey) : undefined

        if (current === undefined || isCacheEntryStale(current)) {
          await this.fill(encodedKey, fill, options)
        }
      })

      options.waitUntil?.(refresh)
    }

    return entry
  }

  abstract revalidate(options: CacheRevalidateOptions): Promise<void>

  protected abstract read(encodedKey: string): Promisable<CacheEntry | undefined>

  /**
   * Runs `fill` and stores its output. Tag state captured before `fill` runs
   * lets a revalidation that lands during it still invalidate the entry.
   */
  protected abstract fill(encodedKey: string, fill: () => Promise<unknown>, options: CacheGetOrSetOptions): Promise<CacheEntry>

  /**
   * Runs `fn` once the key is free, in call order. `waited` is `true` when
   * another caller held it first.
   */
  private async coalesce<T>(encodedKey: string, fn: (waited: boolean) => Promise<T>): Promise<T> {
    const previous = this.pending.get(encodedKey)
    const run = () => fn(previous !== undefined)
    const current = previous?.then(run, run) ?? run()

    this.pending.set(encodedKey, current)

    try {
      return await current
    }
    finally {
      if (this.pending.get(encodedKey) === current) {
        this.pending.delete(encodedKey)
      }
    }
  }
}
