import type { RPCJsonSerialization } from '@orpc/client'
import type { Public } from '@orpc/shared'
import type { CacheProvider, GetOrSetForeverOptions } from 'bentocache/types'
import type { CacheEntry, CacheGetOrSetOptions, CacheRevalidateOptions, CacheStore } from '../types'
import { RPCJsonSerializer } from '@orpc/client'
import { errors } from 'bentocache'
import { encodeCacheKey, resolveCacheExpiry } from '../utils'

interface BentoCacheStoreEnvelope {
  output: RPCJsonSerialization
  tags?: readonly string[]
  expiresAt?: number | undefined
  evictAt?: number | undefined
}

export interface BentoCacheStoreOptions {
  /**
   * Serializer for keys and cached outputs.
   *
   * @default RPCJsonSerializer
   */
  serializer?: undefined | Public<RPCJsonSerializer>
}

/**
 * Cache store adapter for BentoCache, driven by its own `getOrSet`, so any of
 * its setups can back the cache and a namespace keeps entries apart from the
 * rest of it. A miss fills under BentoCache's lock, `ttl` maps to its TTL and
 * `swr` to its grace period, so it serves stale entries while refreshing them
 * in the background itself: only a failed refresh reaches `waitUntil`, and
 * without it the failure surfaces as an unhandled rejection. Tags are
 * deleted natively through `deleteByTag`, which BentoCache treats like an
 * expiry, so with `swr` a revalidated entry is served once more while a
 * refresh runs. A revalidation landing while a fill runs is not detected.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class BentoCacheStore implements CacheStore {
  private readonly serializer: Public<RPCJsonSerializer>

  constructor(
    private readonly bento: CacheProvider,
    options: BentoCacheStoreOptions = {},
  ) {
    this.serializer = options.serializer ?? new RPCJsonSerializer()
  }

  async getOrSet(key: unknown, fill: () => Promise<unknown>, options: CacheGetOrSetOptions = {}): Promise<CacheEntry> {
    const { tags, ttl, swr, waitUntil } = options

    const request: GetOrSetForeverOptions<BentoCacheStoreEnvelope> = {
      key: encodeCacheKey(key, this.serializer),
      factory: async () => {
        const output = await fill()
        const { json, meta } = this.serializer.serialize(output)
        const { expiresAt, evictAt } = resolveCacheExpiry(options)

        return { output: { json, meta }, tags, expiresAt, evictAt }
      },
      grace: swr === undefined ? false : swr * 1000,
      ...(tags?.length ? { tags: [...tags] } : {}),
      onFactoryError: (error) => {
        if (error.isBackgroundFactory) {
          const failure = Promise.reject(error.cause)
          waitUntil?.(failure)
        }
      },
    }

    let envelope: BentoCacheStoreEnvelope

    try {
      envelope = ttl === undefined
        ? await this.bento.getOrSetForever(request)
        : await this.bento.getOrSet({ ...request, ttl: ttl * 1000 })
    }
    catch (error) {
      throw error instanceof errors.E_FACTORY_ERROR ? error.cause : error
    }

    return {
      output: this.serializer.deserialize(envelope.output),
      tags: envelope.tags,
      expiresAt: envelope.expiresAt,
      evictAt: envelope.evictAt,
    }
  }

  async revalidate({ tags }: CacheRevalidateOptions): Promise<void> {
    await this.bento.deleteByTag({ tags: [...tags] })
  }
}
