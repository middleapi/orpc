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
  private nextSweepAt: number = 0

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
   * Drops expired windows, at most once per window.
   */
  private sweepIfNeeded(now: number): void {
    if (now < this.nextSweepAt) {
      return
    }

    for (const [key, entry] of this.entries) {
      if (entry.reset <= now) {
        this.entries.delete(key)
      }
    }

    this.nextSweepAt = now + this.window
  }

  private checkLimit(key: string, weight: number): Required<RateLimitResult> {
    const now = Date.now()
    this.sweepIfNeeded(now)

    let entry = this.entries.get(key)

    if (entry && entry.reset <= now) {
      this.entries.delete(key)
      entry = undefined
    }

    const used = entry?.used ?? 0
    const success = used + weight <= this.maxRequests

    if (!success) {
      return {
        success,
        limit: this.maxRequests,
        remaining: Math.max(0, this.maxRequests - used),
        reset: entry?.reset ?? now + this.window,
      }
    }

    if (!entry) {
      entry = { used: 0, reset: now + this.window }
      this.entries.set(key, entry)
    }

    entry.used += weight

    return {
      success,
      limit: this.maxRequests,
      remaining: this.maxRequests - entry.used,
      reset: entry.reset,
    }
  }
}
