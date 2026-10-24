import type { BaseRedisLockerOptions } from '@orpc/experimental-lock/base-redis'
import type { RedisClient } from 'bun'
import { BaseRedisLocker } from '@orpc/experimental-lock/base-redis'

/**
 * Locker adapter for Bun's built-in Redis client. Acquires locks with `SET NX PX`
 * and releases them atomically with a Lua script. It shares locks with `RedisLocker`.
 *
 * @see {@link https://orpc.dev/docs/helpers/lock#adapters | Lock Helpers - Adapters}
 */
export class experimental_BunRedisLocker extends BaseRedisLocker {
  constructor(
    private readonly redis: RedisClient,
    private readonly options: BaseRedisLockerOptions,
  ) {
    super(options)
  }

  /**
   * Creates a locker with `prefix` appended to this locker's prefix, sharing its Redis client.
   *
   * @see {@link https://orpc.dev/docs/helpers/lock#adapters | Lock Helpers - Adapters}
   */
  prefix(prefix: string): experimental_BunRedisLocker {
    // eslint-disable-next-line new-cap
    return new experimental_BunRedisLocker(this.redis, { ...this.options, prefix: `${this.keyPrefix}${prefix}` })
  }

  protected async acquire(key: string, token: string, ttl: number): Promise<boolean> {
    const result = await this.redis.send('SET', [key, token, 'NX', 'PX', String(ttl)])

    return result === 'OK'
  }

  protected async evalScript(script: string, keys: string[], args: string[]): Promise<unknown> {
    return await this.redis.send('EVAL', [script, String(keys.length), ...keys, ...args])
  }
}
