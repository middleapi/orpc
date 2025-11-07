import type { Ratelimiter, RatelimiterLimitResult } from '../types'
import { fallback } from '@orpc/shared'

/**
 * Sliding window log Lua script for Redis.
 *
 * This script implements atomic sliding window log rate limiting using Redis sorted sets.
 * It removes expired entries, checks the current count, and adds new requests atomically.
 *
 * @returns A tuple with [success, limit, remaining, reset] where:
 * - success: 1 if request is allowed, 0 if rate limited
 * - limit: The maximum number of requests allowed
 * - remaining: Number of requests remaining in the window
 * - reset: Unix timestamp (in milliseconds) when the window resets
 */
const SLIDING_WINDOW_LOG_LUA_SCRIPT = `
local key = KEYS[1]
local now_ms = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

local window_start_ms = now_ms - window_ms

-- Remove old entries outside the current window
redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start_ms)

-- Count requests in the current window
local current_count = redis.call('ZCARD', key)

-- Calculate reset time (end of current window)
local oldest_entry = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local reset_at
if #oldest_entry > 0 then
  reset_at = tonumber(oldest_entry[2]) + window_ms
else
  reset_at = now_ms + window_ms
end

if current_count < limit then
  -- Add current request
  redis.call('ZADD', key, now_ms, now_ms .. ':' .. math.random())
  redis.call('PEXPIRE', key, window_ms)

  return {1, limit, limit - current_count - 1, reset_at}
else
  return {0, limit, 0, reset_at}
end
`

export interface RedisRatelimiterOptions {
  eval: (script: string, numKeys: number, ...rest: string[]) => Promise<unknown>

  /**
   * Block until the request may pass or timeout is reached.
   */
  blockingUntilReady?: {
    enabled: boolean
    timeout: number
  }

  /**
   * The prefix to use for Redis keys.
   *
   * @default orpc:ratelimit:
   */
  prefix?: string

  /**
   * Maximum number of requests allowed within the window.
   */
  maxRequests: number

  /**
   * The duration of the sliding window in milliseconds.
   */
  window: number
}

export class RedisRatelimiter implements Ratelimiter {
  private readonly eval: RedisRatelimiterOptions['eval']
  private readonly prefix: string
  private readonly maxRequests: number
  private readonly window: number
  private readonly blockingUntilReady: RedisRatelimiterOptions['blockingUntilReady']

  constructor(
    options: RedisRatelimiterOptions,
  ) {
    this.eval = options.eval
    this.prefix = fallback(options.prefix, 'orpc:ratelimit:')
    this.maxRequests = options.maxRequests
    this.window = options.window
    this.blockingUntilReady = options.blockingUntilReady
  }

  async limit(key: string): Promise<Required<RatelimiterLimitResult>> {
    const prefixedKey = `${this.prefix}${key}`

    if (this.blockingUntilReady?.enabled) {
      return await this.blockUntilReady(prefixedKey, this.blockingUntilReady.timeout)
    }

    return await this.checkLimit(prefixedKey)
  }

  private async checkLimit(key: string) {
    const result = await this.eval(
      SLIDING_WINDOW_LOG_LUA_SCRIPT,
      1,
      key,
      Date.now().toString(),
      this.window.toString(),
      this.maxRequests.toString(),
    )

    if (!Array.isArray(result) || result.length !== 4) {
      throw new TypeError('Invalid response from rate limit script')
    }

    const numbers = result.map((item) => {
      const num = Number(item)
      if (!Number.isInteger(num)) {
        throw new TypeError('Invalid response from rate limit script')
      }
      return num
    })

    const [success, limit, remaining, reset] = numbers as [number, number, number, number]

    return {
      success: success === 1,
      limit,
      remaining,
      reset,
    }
  }

  private async blockUntilReady(key: string, timeoutMs: number) {
    const deadlineAtMs = Date.now() + timeoutMs

    while (true) {
      const result = await this.checkLimit(key)

      if (result.success || result.reset > deadlineAtMs) {
        return result
      }

      await new Promise(resolve => setTimeout(resolve, result.reset - Date.now()))
    }
  }
}
