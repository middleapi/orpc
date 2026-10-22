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
    options: UpstashRateLimiterOptions,
  ) {
    super(options)
  }

  protected async evalScript(script: string, keys: string[], args: string[]): Promise<unknown> {
    return await this.redis.eval(script, keys, args)
  }
}
