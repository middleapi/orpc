import type { RedisClientType, RedisClusterType } from 'redis'
import type { BaseRedisCacheStoreOptions } from './base-redis'
import { BaseRedisCacheStore } from './base-redis'

export type RedisCacheStoreOptions = BaseRedisCacheStoreOptions

/**
 * Cache store adapter for Redis. Works with both standalone and cluster
 * clients, connecting a closed client on first use, and shares its key and
 * entry format with the other Redis-backed adapters, so any of them can
 * serve the same database.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class RedisCacheStore extends BaseRedisCacheStore {
  constructor(
    private readonly redis: RedisClientType<any, any, any, any, any> | RedisClusterType<any, any, any, any, any>,
    options: RedisCacheStoreOptions = {},
  ) {
    super(options)
  }

  protected async get(key: string): Promise<unknown> {
    await this.connectIfNeeded()

    return this.redis.get(key)
  }

  protected async getMany(keys: string[]): Promise<unknown[]> {
    await this.connectIfNeeded()

    return Promise.all(keys.map(key => this.redis.get(key)))
  }

  protected async set(key: string, value: string, px: number | undefined): Promise<unknown> {
    await this.connectIfNeeded()

    return px === undefined
      ? this.redis.set(key, value)
      : this.redis.set(key, value, { expiration: { type: 'PX', value: px } })
  }

  protected async delete(key: string): Promise<unknown> {
    await this.connectIfNeeded()

    return this.redis.del(key)
  }

  protected async increment(key: string): Promise<unknown> {
    await this.connectIfNeeded()

    return this.redis.incr(key)
  }

  private async connectIfNeeded(): Promise<void> {
    if (!this.redis.isOpen) {
      await this.redis.connect()
    }
  }
}
