import type { RPCJsonSerialization } from '@orpc/client'
import { RPCJsonSerializer } from '@orpc/client'
import type { Locker, LockOptions } from '@orpc/experimental-lock'
import { LockTimeoutError } from '@orpc/experimental-lock'
import { MemoryLocker } from '@orpc/experimental-lock/memory'
import type { Promisable, Public } from '@orpc/shared'

import type { CacheEntry, CacheGetOrSetOptions, CacheRevalidateOptions, CacheStore } from '../types'
import {
  createCacheEntry,
  encodeCacheKey,
  isCacheEntryEvicted,
  isCacheEntryStale,
  resolveCacheExpiry,
} from '../utils'

/**
 * What a backend stores for an entry: the output serialized for JSON, the
 * tags, and the lifetime.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export interface CacheEnvelope extends Omit<CacheEntry, 'output'> {
  output: RPCJsonSerialization
}

export interface BaseKeyValueCacheStoreOptions {
  /**
   * Serializer for keys, and for cached outputs where the backend stores
   * them serialized.
   *
   * @default RPCJsonSerializer
   */
  serializer?: Public<RPCJsonSerializer> | undefined

  /**
   * Coalesces concurrent fills of one key. The default locks within the
   * process; a shared locker such as `RedisLocker` coalesces across processes.
   *
   * @default new MemoryLocker({ ttl: 60_000 })
   */
  locker?: Locker | undefined
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
    this.locker = options.locker ?? new MemoryLocker({ ttl: 60_000 })
  }

  async getOrSet(
    key: unknown,
    compute: () => Promise<unknown>,
    options: CacheGetOrSetOptions = {},
  ): Promise<CacheEntry> {
    const encodedKey = encodeCacheKey(key, this.serializer)
    const entry = live(await this.read(encodedKey, options))

    if (entry !== undefined && !isCacheEntryStale(entry)) {
      return entry
    }

    const { retention } = resolveCacheExpiry(options)

    // A lifetime that leaves nothing to keep stores nothing: backends reject such writes.
    if (retention !== undefined && retention <= 0) {
      return entry ?? createCacheEntry(await compute(), options).entry
    }

    if (entry === undefined) {
      return this.lock(
        encodedKey,
        async (waited) =>
          (waited ? live(await this.read(encodedKey, options)) : undefined) ??
          this.fill(encodedKey, compute, options),
        () => this.fill(encodedKey, compute, options),
      )
    }

    const refresh = this.lock(
      encodedKey,
      async () => {
        await this.fill(encodedKey, compute, options)
      },
      () => undefined,
      { timeout: 0 },
    )

    options.waitUntil?.(refresh)

    return entry
  }

  abstract revalidate(options: CacheRevalidateOptions): Promise<void>

  /**
   * Reads the entry under `encodedKey`, dropping it when it was revalidated.
   * `options` are those of the lookup, so a backend can fetch what it needs
   * to validate the entry alongside it.
   */
  protected abstract read(
    encodedKey: string,
    options: CacheGetOrSetOptions,
  ): Promisable<CacheEntry | undefined>

  /**
   * Runs `compute` and stores its output. Tag state captured before it runs
   * lets a revalidation that lands during it still invalidate the entry.
   * Only called for lifetimes that retain the entry.
   */
  protected abstract fill(
    encodedKey: string,
    compute: () => Promise<unknown>,
    options: CacheGetOrSetOptions,
  ): Promise<CacheEntry>

  /**
   * Restores the entry a backend stored as an envelope.
   */
  protected decode(envelope: CacheEnvelope): CacheEntry {
    return {
      output: this.serializer.deserializeJson(envelope.output),
      tags: envelope.tags,
      expiresAt: envelope.expiresAt,
      evictAt: envelope.evictAt,
    }
  }

  /**
   * Builds the envelope storing `output`, with the entry to return and its `retention`.
   */
  protected encode(
    output: unknown,
    options: CacheGetOrSetOptions,
  ): { envelope: CacheEnvelope; entry: CacheEntry; retention: number | undefined } {
    const { entry, retention } = createCacheEntry(output, options)
    const { json, meta } = this.serializer.serializeJson(output)

    return { envelope: { ...entry, output: { json, meta } }, entry, retention }
  }

  private async lock<T>(
    encodedKey: string,
    fn: (waited: boolean) => Promise<T>,
    onTimeout: () => Promisable<T>,
    options?: LockOptions,
  ): Promise<T> {
    try {
      return await this.locker.lock(encodedKey, ({ waited }) => fn(waited), options)
    } catch (error) {
      if (error instanceof LockTimeoutError) {
        return onTimeout()
      }

      throw error
    }
  }
}

function live(entry: CacheEntry | undefined): CacheEntry | undefined {
  return entry === undefined || isCacheEntryEvicted(entry) ? undefined : entry
}
