import type { BaseRedisCacheStoreOptions } from '@orpc/experimental-cache/base-redis'
import type { RedisClient } from 'bun'
import { BaseRedisCacheStore } from '@orpc/experimental-cache/base-redis'

export type experimental_BunRedisCacheStoreOptions = BaseRedisCacheStoreOptions

/**
 * Cache store adapter for Bun's built-in Redis client. Shares its key and
 * entry format with `RedisCacheStore`, so both can serve the same database.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class experimental_BunRedisCacheStore extends BaseRedisCacheStore {
  constructor(
    private readonly redis: RedisClient,
    options: experimental_BunRedisCacheStoreOptions = {},
  ) {
    super(options)
  }

  protected get(key: string): Promise<unknown> {
    return this.redis.get(key)
  }

  protected getMany(keys: string[]): Promise<unknown[]> {
    return this.redis.send('MGET', keys) as Promise<unknown[]>
  }

  protected set(key: string, value: string, px: number | undefined): Promise<unknown> {
    return px === undefined
      ? this.redis.set(key, value)
      : this.redis.send('SET', [key, value, 'PX', String(px)])
  }

  protected increment(key: string): Promise<unknown> {
    return this.redis.incr(key)
  }
}
