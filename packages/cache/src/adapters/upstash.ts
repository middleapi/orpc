import type { Redis } from '@upstash/redis'
import type { BaseRedisCacheStoreOptions } from './base-redis'
import { BaseRedisCacheStore } from './base-redis'

export type UpstashCacheStoreOptions = BaseRedisCacheStoreOptions

/**
 * Cache store adapter for Upstash Redis. Shares its key and entry format with
 * `RedisCacheStore`, so both can serve the same database. A good fit for
 * serverless and edge runtimes.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class UpstashCacheStore extends BaseRedisCacheStore {
  constructor(
    private readonly redis: Redis,
    options: UpstashCacheStoreOptions = {},
  ) {
    super(options)
  }

  protected get(key: string): Promise<unknown> {
    return this.redis.get(key)
  }

  protected getMany(keys: string[]): Promise<unknown[]> {
    return this.redis.mget(...keys)
  }

  protected set(key: string, value: string, px: number | undefined): Promise<unknown> {
    return px === undefined
      ? this.redis.set(key, value)
      : this.redis.set(key, value, { px })
  }

  protected increment(key: string): Promise<unknown> {
    return this.redis.incr(key)
  }
}
