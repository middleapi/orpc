import type { RateLimiter, RateLimitOptions, RateLimitResult } from '@orpc/ratelimit'
import type { RedisClient } from 'bun'
import { sleep } from '@orpc/shared'

const FIXED_WINDOW_RATELIMIT_SCRIPT = `
local key = KEYS[1]
local weight = tonumber(ARGV[1])
local window = tonumber(ARGV[2])

local current = redis.call('INCRBY', key, weight)

if current == weight then
  redis.call('PEXPIRE', key, window)
end

local ttl = redis.call('PTTL', key)

return { current, ttl }
`

export interface BunRedisRateLimiterOptions {
  /**
   * The prefix to use for Redis keys.
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
   * Block until the request may pass or timeout is reached.
   */
  blockingUntilReady?: {
    enabled: boolean
    timeout: number
  }
}

export class BunRedisRateLimiter implements RateLimiter {
  private readonly redis: RedisClient
  private readonly prefix: string
  private readonly maxRequests: number
  private readonly window: number
  private readonly blockingUntilReady: BunRedisRateLimiterOptions['blockingUntilReady']

  private scriptSha: string | undefined

  constructor(
    redis: RedisClient,
    options: BunRedisRateLimiterOptions,
  ) {
    this.redis = redis
    this.prefix = options.prefix ?? ''
    this.maxRequests = options.maxRequests
    this.window = options.window
    this.blockingUntilReady = options.blockingUntilReady
  }

  async limit(key: string, options?: RateLimitOptions): Promise<Required<RateLimitResult>> {
    key = `${this.prefix}${key}`
    const weight = this.resolveWeight(options)

    return this.blockingUntilReady?.enabled
      ? this.blockUntilReady(key, this.blockingUntilReady.timeout, weight)
      : this.checkLimit(key, weight)
  }

  private async checkLimit(key: string, weight: number): Promise<Required<RateLimitResult>> {
    const [used, ttl] = await this.executeScript(key, weight)

    return {
      success: used <= this.maxRequests,
      limit: this.maxRequests,
      remaining: Math.max(0, this.maxRequests - used),
      reset: Date.now() + ttl,
    }
  }

  private async blockUntilReady(
    key: string,
    timeoutMs: number,
    weight: number,
  ): Promise<Required<RateLimitResult>> {
    const deadlineAtMs = Date.now() + timeoutMs

    while (true) {
      const result = await this.checkLimit(key, weight)

      if (result.success || result.reset > deadlineAtMs) {
        return result
      }

      await sleep(result.reset - Date.now())
    }
  }

  private async executeScript(
    key: string,
    weight: number,
  ): Promise<[used: number, ttl: number]> {
    try {
      return await this.evalSha(key, weight)
    }
    catch (error) {
      if (error instanceof Error && error.message.startsWith('NOSCRIPT')) {
        this.scriptSha = undefined
        return await this.evalSha(key, weight)
      }

      throw error
    }
  }

  private async evalSha(
    key: string,
    weight: number,
  ): Promise<[number, number]> {
    this.scriptSha ??= await this.redis.send('SCRIPT', [
      'LOAD',
      FIXED_WINDOW_RATELIMIT_SCRIPT,
    ]) as string

    return await this.redis.send('EVALSHA', [
      this.scriptSha,
      '1',
      key,
      String(weight),
      String(this.window),
    ]) as [number, number]
  }

  private resolveWeight(options?: RateLimitOptions): number {
    const weight = options?.weight ?? 1

    if (!Number.isInteger(weight) || weight <= 0) {
      throw new TypeError(
        'Rate limit weight must be an integer greater than 0',
      )
    }

    return weight
  }
}
