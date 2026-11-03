import type { RateLimiter, RateLimitOptions, RateLimitResult } from '../types'
import { blockUntilReady, resolveWeight } from '../utils'

/**
 * Consumes `ARGV[1]` points from the counter at `KEYS[1]` when the total stays within `ARGV[3]`,
 * ensures a window of `ARGV[2]` milliseconds, and replies with `[success, used, ttl]`.
 * Kept on one line because `EVAL` sends it with every call.
 */
const FIXED_WINDOW_SCRIPT = `local w=tonumber(ARGV[1]) local p=tonumber(ARGV[2]) local c=tonumber(redis.call('GET',KEYS[1]) or '0') local ok=0 if c+w<=tonumber(ARGV[3]) then c=redis.call('INCRBY',KEYS[1],w) ok=1 end local t=redis.call('PTTL',KEYS[1]) if t<0 then redis.call('PEXPIRE',KEYS[1],p) t=p end return {ok,c,t}`

/**
 * Options shared by every Redis-backed rate limiter adapter.
 *
 * @see {@link https://orpc.dev/docs/helpers/ratelimit#adapters | Rate Limit Helpers - Adapters}
 */
export interface BaseRedisRateLimiterOptions {
  /**
   * The prefix to use for Redis keys.
   *
   * @default ''
   */
  prefix?: string | undefined

  /**
   * Maximum number of requests allowed within the window.
   */
  maxRequests: number

  /**
   * The duration of the fixed window in milliseconds.
   */
  window: number

  /**
   * How long to wait for capacity to become available, in milliseconds.
   * Gives up right away when the window will not reset before the timeout elapses,
   * or when the request weight exceeds `maxRequests`.
   *
   * @default 0
   */
  timeout?: number | undefined
}

/**
 * Base class for Redis-backed rate limiter adapters. It owns the key naming,
 * the fixed-window script, and the blocking logic, so every adapter built on
 * it shares counters with the others regardless of the Redis client in use.
 *
 * Extend it and implement `evalScript` to support another Redis client.
 *
 * @see {@link https://orpc.dev/docs/helpers/ratelimit#adapters | Rate Limit Helpers - Adapters}
 */
export abstract class BaseRedisRateLimiter implements RateLimiter {
  protected readonly keyPrefix: string
  protected readonly maxRequests: number
  protected readonly window: number
  protected readonly timeout: number

  constructor(options: BaseRedisRateLimiterOptions) {
    if (!Number.isInteger(options.window) || options.window <= 0) {
      throw new TypeError('Rate limit window must be an integer greater than 0')
    }

    this.keyPrefix = options.prefix ?? ''
    this.maxRequests = options.maxRequests
    this.window = options.window
    this.timeout = options.timeout ?? 0
  }

  /**
   * Runs a Lua script (`EVAL script numkeys key [key ...] arg [arg ...]`) and resolves with its reply.
   */
  protected abstract evalScript(script: string, keys: string[], args: string[]): Promise<unknown>

  async limit(key: string, options?: RateLimitOptions): Promise<Required<RateLimitResult>> {
    key = `${this.keyPrefix}${key}`
    const weight = resolveWeight(options)

    return blockUntilReady(() => this.checkLimit(key, weight), weight, this.timeout)
  }

  private async checkLimit(key: string, weight: number): Promise<Required<RateLimitResult>> {
    const [success, used, ttl] = await this.evalScript(
      FIXED_WINDOW_SCRIPT,
      [key],
      [String(weight), String(this.window), String(this.maxRequests)],
    ) as [success: number, used: number, ttl: number]

    return {
      success: success === 1,
      limit: this.maxRequests,
      remaining: Math.max(0, this.maxRequests - used),
      reset: Date.now() + ttl,
    }
  }
}
