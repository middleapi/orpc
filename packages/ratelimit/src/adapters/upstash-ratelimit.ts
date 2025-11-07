import type { Ratelimit } from '@upstash/ratelimit'
import type { Ratelimiter, RatelimiterLimitResult } from '../types'

export interface UpstashRatelimiterOptions {
  /**
   * Block until the request may pass or timeout is reached.
   */
  blockingUntilReady?: {
    enabled: boolean
    timeout: number
  }

  /**
   * For the MultiRegion setup we do some synchronizing in the background, after returning the current limit.
   * Or when analytics is enabled, we send the analytics asynchronously after returning the limit.
   * In most case you can simply ignore this.
   *
   * On Vercel Edge or Cloudflare workers, you might need `.bind` before assign:
   * ```ts
   * const ratelimiter = new UpstashRatelimiter(ratelimit, {
   *   waitUntil: ctx.waitUntil.bind(ctx),
   * })
   * ```
   */
  waitUntil?: (promise: Promise<any>) => any
}

export class UpstashRatelimiter implements Ratelimiter {
  private blockingUntilReady: UpstashRatelimiterOptions['blockingUntilReady']
  private waitUntil: UpstashRatelimiterOptions['waitUntil']

  constructor(
    private readonly ratelimit: Ratelimit,
    options: UpstashRatelimiterOptions = {},
  ) {
    this.blockingUntilReady = options.blockingUntilReady
    this.waitUntil = options.waitUntil
  }

  async limit(key: string): Promise<Required<RatelimiterLimitResult>> {
    const result = this.blockingUntilReady?.enabled
      ? await this.ratelimit.blockUntilReady(key, this.blockingUntilReady.timeout)
      : await this.ratelimit.limit(key)

    this.waitUntil?.(result.pending)
    return result
  }
}
