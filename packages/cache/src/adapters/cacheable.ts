import type { Cacheable } from 'cacheable'
import type { CacheEntry, CacheGetOrSetOptions, CacheRevalidateOptions } from '../types'
import type { BaseKeyValueCacheStoreOptions, CacheEnvelope } from './base-key-value'
import { BaseKeyValueCacheStore } from './base-key-value'

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
    const envelope = await this.cacheable.get<CacheEnvelope>(encodedKey)

    return envelope === undefined ? undefined : this.decode(envelope)
  }

  protected async fill(encodedKey: string, compute: () => Promise<unknown>, options: CacheGetOrSetOptions): Promise<CacheEntry> {
    const { envelope, entry, retention } = this.encode(await compute(), options)

    await this.cacheable.set(encodedKey, envelope, {
      ...(envelope.tags ? { tags: [...envelope.tags] } : {}),
      ...(retention !== undefined ? { ttl: retention } : {}),
    })

    return entry
  }
}
