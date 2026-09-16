import type { RPCJsonSerialization } from '@orpc/client'
import type { Locker } from '@orpc/experimental-lock'
import type { Promisable, Public } from '@orpc/shared'
import type { CacheEntry, CacheGetOrSetOptions, CacheRevalidateOptions, CacheStore } from '../types'
import { RPCJsonSerializer } from '@orpc/client'
import { LockTimeoutError } from '@orpc/experimental-lock'
import { MemoryLocker } from '@orpc/experimental-lock/memory'
import { encodeCacheKey, isCacheEntryEvicted, isCacheEntryStale, resolveCacheExpiry } from '../utils'

/**
 * What a backend stores for an entry: the output serialized for JSON, the
 * tags, and the lifetime.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export interface CacheEnvelope {
  output: RPCJsonSerialization
  tags?: readonly string[] | undefined
  expiresAt?: number | undefined
  evictAt?: number | undefined
}

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
 * fill the missing ones, encoding outputs as envelopes where the backend
 * stores them serialized.
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

  async getOrSet(key: unknown, compute: () => Promise<unknown>, options: CacheGetOrSetOptions = {}): Promise<CacheEntry> {
    const encodedKey = encodeCacheKey(key, this.serializer)
    const entry = await this.read(encodedKey, options)

    if (entry === undefined || isCacheEntryEvicted(entry)) {
      return this.lock(encodedKey, async (waited) => {
        const current = waited ? await this.read(encodedKey, options) : undefined

        return current === undefined || isCacheEntryEvicted(current)
          ? this.fill(encodedKey, compute, options)
          : current
      }, () => this.fill(encodedKey, compute, options))
    }

    if (isCacheEntryStale(entry)) {
      const refresh = this.lock(encodedKey, async (waited) => {
        const current = waited ? await this.read(encodedKey, options) : undefined

        if (current === undefined || isCacheEntryStale(current)) {
          await this.fill(encodedKey, compute, options)
        }
      }, () => undefined)

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
   * Runs `compute` and stores its output. Tag state captured before it runs
   * lets a revalidation that lands during it still invalidate the entry.
   */
  protected abstract fill(encodedKey: string, compute: () => Promise<unknown>, options: CacheGetOrSetOptions): Promise<CacheEntry>

  /**
   * Restores the entry a backend stored as an envelope.
   */
  protected decode(envelope: CacheEnvelope): CacheEntry {
    return {
      output: this.serializer.deserialize(envelope.output),
      tags: envelope.tags,
      expiresAt: envelope.expiresAt,
      evictAt: envelope.evictAt,
    }
  }

  /**
   * Builds the envelope storing `output`, with the entry to return and how
   * long to retain it in milliseconds, `undefined` when it never expires.
   */
  protected encode(output: unknown, options: CacheGetOrSetOptions): { envelope: CacheEnvelope, entry: CacheEntry, retention: number | undefined } {
    const tags = options.tags?.length ? options.tags : undefined
    const { expiresAt, evictAt, retention } = resolveCacheExpiry(options)
    const { json, meta } = this.serializer.serialize(output)

    return {
      envelope: { output: { json, meta }, tags, expiresAt, evictAt },
      entry: { output, tags, expiresAt, evictAt },
      retention,
    }
  }

  /**
   * Runs `fn` under the key's lock, or `onTimeout` once waiting for it timed out.
   */
  private async lock<T>(encodedKey: string, fn: (waited: boolean) => Promise<T>, onTimeout: () => Promisable<T>): Promise<T> {
    try {
      return await this.locker.lock(encodedKey, ({ waited }) => fn(waited))
    }
    catch (error) {
      if (error instanceof LockTimeoutError) {
        return onTimeout()
      }

      throw error
    }
  }
}
