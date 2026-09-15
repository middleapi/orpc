import type { RPCJsonSerialization } from '@orpc/client'
import type { Cacheable } from 'cacheable'
import type { CacheEntry, CacheGetOrSetOptions, CacheRevalidateOptions } from '../types'
import type { BaseKeyValueCacheStoreOptions } from './base-key-value'
import { nowInSeconds } from '@orpc/shared'
import { resolveCacheExpiry } from '../utils'
import { BaseKeyValueCacheStore } from './base-key-value'

interface CacheableCacheStoreEnvelope {
  output: RPCJsonSerialization
  tags?: readonly string[]
  expiresAt?: number | undefined
  evictAt?: number | undefined
}

export type CacheableCacheStoreOptions = BaseKeyValueCacheStoreOptions

/**
 * Cache store adapter for Cacheable, so its primary and secondary stores back
 * the cache, such as a memory tier in front of any Keyv store. Tags are
 * invalidated natively through its tag service, which the store enables, and
 * entries are retained for `ttl + swr`; one without a `ttl` follows the
 * instance's own default. A revalidation landing while a fill runs is not
 * detected, since Cacheable records tag versions when the entry is written.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class CacheableCacheStore extends BaseKeyValueCacheStore {
  constructor(
    private readonly cacheable: Cacheable,
    options: CacheableCacheStoreOptions = {},
  ) {
    super(options)
    cacheable.tags.enabled = true
  }

  async revalidate({ tags }: CacheRevalidateOptions): Promise<void> {
    await this.cacheable.tags.invalidateTags([...tags])
  }

  protected async read(encodedKey: string): Promise<CacheEntry | undefined> {
    const envelope = await this.cacheable.get<CacheableCacheStoreEnvelope>(encodedKey)

    if (envelope === undefined) {
      return undefined
    }

    if (envelope.evictAt !== undefined && nowInSeconds() >= envelope.evictAt) {
      await this.cacheable.delete(encodedKey)
      return undefined
    }

    return {
      output: this.serializer.deserialize(envelope.output),
      tags: envelope.tags,
      expiresAt: envelope.expiresAt,
      evictAt: envelope.evictAt,
    }
  }

  protected async fill(encodedKey: string, fill: () => Promise<unknown>, options: CacheGetOrSetOptions): Promise<CacheEntry> {
    const output = await fill()
    const tags = options.tags
    const { expiresAt, evictAt, retention } = resolveCacheExpiry(options)
    const { json, meta } = this.serializer.serialize(output)

    const envelope: CacheableCacheStoreEnvelope = {
      output: { json, meta },
      tags,
      expiresAt,
      evictAt,
    }

    await this.cacheable.set(encodedKey, envelope, {
      ...(tags?.length ? { tags: [...tags] } : {}),
      ...(retention !== undefined ? { ttl: retention * 1000 } : {}),
    })

    return { output, tags, expiresAt, evictAt }
  }
}
