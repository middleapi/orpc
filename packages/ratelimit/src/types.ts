export interface RatelimiterLimitResult {
  /**
   * Whether the request may pass(true) or exceeded the limit(false)
   */
  success: boolean
  /**
   * Maximum number of requests allowed within a window.
   */
  limit?: number
  /**
   * How many requests the user has left within the current window.
   */
  remaining?: number
  /**
   * Unix timestamp in milliseconds when the limits are reset.
   */
  reset?: number
}

export interface Ratelimiter {
  limit(key: string): Promise<RatelimiterLimitResult>
}
