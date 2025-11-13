import type { Ratelimiter, RatelimiterLimitResult } from '../types'

export class CloudflareRatelimiter implements Ratelimiter {
  constructor(
    private readonly ratelimit: {
      limit: (options: { key: string }) => Promise<RatelimiterLimitResult>
    },
  ) {}

  limit(key: string): Promise<RatelimiterLimitResult> {
    return this.ratelimit.limit({ key })
  }
}
