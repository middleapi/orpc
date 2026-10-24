import type { Redis } from '@upstash/redis'
import type { BaseRedisRateLimiterOptions } from './base-redis'
import { BaseRedisRateLimiter } from './base-redis'

export interface UpstashRateLimiterOptions extends BaseRedisRateLimiterOptions {}

/**
 * Rate limiter adapter for Upstash Redis. Enforces a fixed-window limit using a
 * Redis Lua script, with optional blocking mode. It shares counters with `RedisRateLimiter`.
 *
 * @see {@link https://orpc.dev/docs/helpers/ratelimit#adapters | Rate Limit Helpers - Adapters}
 */
export class UpstashRateLimiter extends BaseRedisRateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly options: UpstashRateLimiterOptions,
  ) {
    super(options)
  }

  /**
   * Creates a limiter with `prefix` appended to this limiter's prefix, sharing its Redis client.
   *
   * @see {@link https://orpc.dev/docs/helpers/ratelimit#adapters | Rate Limit Helpers - Adapters}
   */
  prefix(prefix: string): UpstashRateLimiter {
    return new UpstashRateLimiter(this.redis, { ...this.options, prefix: `${this.keyPrefix}${prefix}` })
  }

  protected async evalScript(script: string, keys: string[], args: string[]): Promise<unknown> {
    return await this.redis.eval(script, keys, args)
  }
}
