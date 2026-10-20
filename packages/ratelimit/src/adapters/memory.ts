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
  timeout?: number
}

/**
 * Rate limiter adapter backed by in-memory storage. Enforces a fixed-window
 * limit, with optional blocking mode.
 *
 * @see {@link https://orpc.dev/docs/helpers/ratelimit#adapters | Rate Limit Helpers - Adapters}
 */
export class MemoryRateLimiter implements RateLimiter {
  private readonly maxRequests: number
  private readonly window: number
  private readonly timeout: number

  private current: Map<string, { used: number }> = new Map()
  private currentEpochStart: number = Date.now()

  constructor(options: MemoryRateLimiterOptions) {
    this.maxRequests = options.maxRequests
    this.window = options.window
    this.timeout = options.timeout ?? 0
  }

  async limit(key: string, options?: RateLimitOptions): Promise<Required<RateLimitResult>> {
    const weight = resolveWeight(options)

    return blockUntilReady(() => this.checkLimit(key, weight), this.timeout)
  }

  private rotateIfNeeded(now: number): void {
    if (now < this.currentEpochStart + this.window) {
      return
    }

    this.current = new Map()
    this.currentEpochStart = now
  }

  private checkLimit(key: string, weight: number): Required<RateLimitResult> {
    const now = Date.now()
    this.rotateIfNeeded(now)

    let entry = this.current.get(key)

    if (!entry) {
      entry = { used: 0 }
      this.current.set(key, entry)
    }

    const reset = this.currentEpochStart + this.window
    const success = entry.used + weight <= this.maxRequests

    if (success) {
      entry.used += weight
    }

    return {
      success,
      limit: this.maxRequests,
      remaining: Math.max(0, this.maxRequests - entry.used),
      reset,
    }
  }
}
