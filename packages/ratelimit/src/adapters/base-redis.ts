import type { RateLimiter, RateLimitOptions, RateLimitResult } from '../types'
import { blockUntilReady, resolveWeight } from '../utils'

/**
 * Consumes `ARGV[1]` points from the counter at `KEYS[1]`, starts a window of
 * `ARGV[2]` milliseconds when the counter is new, and replies with `[used, ttl]`.
 * Kept on one line because `EVAL` sends it with every call.
 */
const FIXED_WINDOW_SCRIPT = `local c=redis.call('INCRBY',KEYS[1],ARGV[1]) if c==tonumber(ARGV[1]) then redis.call('PEXPIRE',KEYS[1],ARGV[2]) end return {c,redis.call('PTTL',KEYS[1])}`

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
  prefix?: string

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
   * Gives up right away when the window will not reset before the timeout elapses.
   *
   * @default 0
   */
  timeout?: number
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
  protected readonly prefix: string
  protected readonly maxRequests: number
  protected readonly window: number
  protected readonly timeout: number

  constructor(options: BaseRedisRateLimiterOptions) {
    this.prefix = options.prefix ?? ''
    this.maxRequests = options.maxRequests
    this.window = options.window
    this.timeout = options.timeout ?? 0
  }

  /**
   * Runs a Lua script (`EVAL script numkeys key [key ...] arg [arg ...]`) and resolves with its reply.
   */
  protected abstract evalScript(script: string, keys: string[], args: string[]): Promise<unknown>

  async limit(key: string, options?: RateLimitOptions): Promise<Required<RateLimitResult>> {
    key = `${this.prefix}${key}`
    const weight = resolveWeight(options)

    return blockUntilReady(() => this.checkLimit(key, weight), this.timeout)
  }

  private async checkLimit(key: string, weight: number): Promise<Required<RateLimitResult>> {
    const [used, ttl] = await this.evalScript(
      FIXED_WINDOW_SCRIPT,
      [key],
      [String(weight), String(this.window)],
    ) as [used: number, ttl: number]

    return {
      success: used <= this.maxRequests,
      limit: this.maxRequests,
      remaining: Math.max(0, this.maxRequests - used),
      reset: Date.now() + ttl,
    }
  }
}
