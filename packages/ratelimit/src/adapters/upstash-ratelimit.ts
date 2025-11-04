import type { Ratelimit } from '@upstash/ratelimit'
import type { Ratelimiter, RatelimiterLimitResult } from '../types'

export interface UpstashRatelimiterOptions {
  /**
   * Block until the request may pass or timeout is reached.
   */
  blockingUntilReady?: {
    enabled: boolean
    timeoutMs: number
  }

  /**
   * For the MultiRegion setup we do some synchronizing in the background, after returning the current limit.
   * Or when analytics is enabled, we send the analytics asynchronously after returning the limit.
   * In most case you can simply ignore this.
   *
   * On Vercel Edge or Cloudflare workers, you might need `.bind` before assign:
   * ```ts
   * const ratelimiter = new UpstashRatelimiter(ratelimit, {
   *   waitUtil: ctx.waitUntil.bind(ctx),
   * })
   * ```
   */
  waitUtil?: (promise: Promise<any>) => any
}

export class UpstashRatelimiter implements Ratelimiter {
  private blockingUntilReady: UpstashRatelimiterOptions['blockingUntilReady']
  private waitUtil: UpstashRatelimiterOptions['waitUtil']

  constructor(
    private readonly ratelimit: Ratelimit,
    options: UpstashRatelimiterOptions = {},
  ) {
    this.blockingUntilReady = options.blockingUntilReady
    this.waitUtil = options.waitUtil
  }

  async limit(key: string): Promise<RatelimiterLimitResult> {
    const result = this.blockingUntilReady?.enabled
      ? await this.ratelimit.blockUntilReady(key, this.blockingUntilReady.timeoutMs)
      : await this.ratelimit.limit(key)

    this.waitUtil?.(result.pending)
    return result
  }
}
