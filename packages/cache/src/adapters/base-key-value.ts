import type { Locker } from '@orpc/experimental-lock'
import type { Promisable, Public } from '@orpc/shared'
import type { CacheEntry, CacheGetOrSetOptions, CacheRevalidateOptions, CacheStore } from '../types'
import { RPCJsonSerializer } from '@orpc/client'
import { LockTimeoutError } from '@orpc/experimental-lock'
import { MemoryLocker } from '@orpc/experimental-lock/memory'
import { encodeCacheKey, isCacheEntryStale } from '../utils'

export interface BaseKeyValueCacheStoreOptions {
  /**
   * Serializer for keys, and for cached outputs where the backend stores
   * them serialized.
   *
   * @default RPCJsonSerializer
   */
  serializer?: undefined | Public<RPCJsonSerializer>

  /**
   * Coalesces concurrent fills of one key, so a miss runs the fill once. The
   * default shares locks within the process; a shared locker such as
   * `RedisLocker` from `@orpc/experimental-lock` shares them across
   * processes. A caller that times out waiting fills on its own.
   *
   * @default new MemoryLocker()
   */
  locker?: undefined | Locker
}

/**
 * Cache store over a key-value backend, coalescing concurrent fills of one
 * key through a locker. Subclasses read entries by their encoded key and
 * fill the missing ones.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export abstract class BaseKeyValueCacheStore implements CacheStore {
  protected readonly serializer: Public<RPCJsonSerializer>
  protected readonly locker: Locker

  constructor(options: BaseKeyValueCacheStoreOptions = {}) {
    this.serializer = options.serializer ?? new RPCJsonSerializer()
    this.locker = options.locker ?? new MemoryLocker()
  }

  async getOrSet(key: unknown, fill: () => Promise<unknown>, options: CacheGetOrSetOptions = {}): Promise<CacheEntry> {
    const encodedKey = encodeCacheKey(key, this.serializer)
    const entry = await this.read(encodedKey, options)

    if (entry === undefined) {
      return (await this.fillOnce(encodedKey, fill, options, false))!
    }

    if (isCacheEntryStale(entry)) {
      const refresh = this.fillOnce(encodedKey, fill, options, true)
      options.waitUntil?.(refresh)
    }

    return entry
  }

  abstract revalidate(options: CacheRevalidateOptions): Promise<void>

  /**
   * Reads the entry under `encodedKey`, dropping it when it was revalidated.
   * `options` are those of the lookup, so a backend can fetch what it needs
   * to validate the entry alongside it.
   */
  protected abstract read(encodedKey: string, options: CacheGetOrSetOptions): Promisable<CacheEntry | undefined>

  /**
   * Runs `fill` and stores its output. Tag state captured before `fill` runs
   * lets a revalidation that lands during it still invalidate the entry.
   */
  protected abstract fill(encodedKey: string, fill: () => Promise<unknown>, options: CacheGetOrSetOptions): Promise<CacheEntry>

  /**
   * Fills under the key's lock, unless a caller that held it first already
   * stored what was needed. On a miss, a caller that timed out waiting fills
   * on its own; a refresh that timed out is left to the holder.
   */
  private async fillOnce(encodedKey: string, fill: () => Promise<unknown>, options: CacheGetOrSetOptions, refresh: boolean): Promise<CacheEntry | undefined> {
    try {
      return await this.locker.lock(encodedKey, async ({ waited }) => {
        const current = waited ? await this.read(encodedKey, options) : undefined

        if (current === undefined || (refresh && isCacheEntryStale(current))) {
          return this.fill(encodedKey, fill, options)
        }

        return current
      })
    }
    catch (error) {
      if (error instanceof LockTimeoutError) {
        return refresh ? undefined : this.fill(encodedKey, fill, options)
      }

      throw error
    }
  }
}
