import type { RateLimiter, RateLimitOptions, RateLimitResult } from '../types'
import { blockUntilReady, resolveWeight } from '../utils'

export interface MemoryRateLimiterOptions {
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
  timeout?: number | undefined
}

/**
 * Rate limiter adapter backed by in-memory storage. Enforces a fixed-window
 * limit, with optional blocking mode.
 *
 * Windows are per key, and rejected requests do not consume quota.
 *
 * @see {@link https://orpc.dev/docs/helpers/ratelimit#adapters | Rate Limit Helpers - Adapters}
 */
export class MemoryRateLimiter implements RateLimiter {
  private readonly maxRequests: number
  private readonly window: number
  private readonly timeout: number

  private readonly entries: Map<string, { used: number; reset: number }> = new Map()

  constructor(options: MemoryRateLimiterOptions) {
    this.maxRequests = options.maxRequests
    this.window = options.window
    this.timeout = options.timeout ?? 0
  }

  async limit(key: string, options?: RateLimitOptions): Promise<Required<RateLimitResult>> {
    const weight = resolveWeight(options)

    return blockUntilReady(() => this.checkLimit(key, weight), this.timeout)
  }

  /**
   * Drops expired windows. Entries are in reset order, so it stops at the first live one.
   */
  private sweep(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.reset > now) {
        break
      }

      this.entries.delete(key)
    }
  }

  private checkLimit(key: string, weight: number): Required<RateLimitResult> {
    const now = Date.now()
    this.sweep(now)

    let entry = this.entries.get(key)
    const success = (entry?.used ?? 0) + weight <= this.maxRequests

    if (success) {
      if (!entry) {
        entry = { used: 0, reset: now + this.window }
        this.entries.set(key, entry)
      }

      entry.used += weight
    }

    return {
      success,
      limit: this.maxRequests,
      remaining: this.maxRequests - (entry?.used ?? 0),
      reset: entry?.reset ?? now + this.window,
    }
  }
}
