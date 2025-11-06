import type { Ratelimiter, RatelimiterLimitResult } from '../types'

export interface MemoryRatelimiterOptions {
  /**
   * Block until the request may pass or timeout is reached.
   */
  blockingUntilReady?: {
    enabled: boolean
    timeout: number
  }

  /**
   * Maximum number of requests allowed within the window.
   */
  maxRequests: number

  /**
   * The duration of the sliding window in milliseconds.
   */
  window: number

}

export class MemoryRatelimiter implements Ratelimiter {
  private readonly maxRequests: number
  private readonly window: number
  private readonly blockingUntilReady: MemoryRatelimiterOptions['blockingUntilReady']
  private readonly store: Map<string, number[]>
  private lastCleanupTime: number | null = null

  constructor(options: MemoryRatelimiterOptions) {
    this.maxRequests = options.maxRequests
    this.window = options.window
    this.blockingUntilReady = options.blockingUntilReady
    this.store = new Map()
  }

  limit(key: string): Promise<Required<RatelimiterLimitResult>> {
    this.cleanup()

    if (this.blockingUntilReady?.enabled) {
      return this.blockUntilReady(key, this.blockingUntilReady.timeout)
    }

    return this.checkLimit(key)
  }

  private cleanup(): void {
    const now = Date.now()

    // Only clean up once per window to avoid excessive processing
    if (this.lastCleanupTime !== null && this.lastCleanupTime + this.window > now) {
      return
    }

    this.lastCleanupTime = now
    const windowStart = now - this.window

    for (const [key, timestamps] of this.store) {
      // remove expired timestamps
      const idx = timestamps.findIndex(timestamp => timestamp >= windowStart)
      timestamps.splice(0, idx === -1 ? timestamps.length : idx)

      if (timestamps.length === 0) {
        this.store.delete(key)
      }
    }
  }

  private async checkLimit(key: string): Promise<Required<RatelimiterLimitResult>> {
    const now = Date.now()
    const windowStart = now - this.window

    let timestamps = this.store.get(key)
    if (timestamps) {
      // Remove expired timestamps
      const idx = timestamps.findIndex(timestamp => timestamp >= windowStart)
      timestamps.splice(0, idx === -1 ? timestamps.length : idx)
    }
    else {
      this.store.set(key, timestamps = [])
    }

    // Calculate reset time based on oldest timestamp or current time if no timestamps
    const reset = timestamps[0] !== undefined
      ? timestamps[0] + this.window
      : now + this.window

    if (timestamps.length >= this.maxRequests) {
      return {
        success: false,
        limit: this.maxRequests,
        remaining: 0,
        reset,
      }
    }

    timestamps.push(now)

    return {
      success: true,
      limit: this.maxRequests,
      remaining: this.maxRequests - timestamps.length,
      reset,
    }
  }

  private async blockUntilReady(key: string, timeoutMs: number): Promise<Required<RatelimiterLimitResult>> {
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
