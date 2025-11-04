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
  /**
   * For the MultiRegion setup we do some synchronizing in the background, after returning the current limit.
   * Or when analytics is enabled, we send the analytics asynchronously after returning the limit.
   * In most case you can simply ignore this.
   */
  pending?: Promise<unknown>
}

export interface Ratelimiter {
  limit(key: string): Promise<RatelimiterLimitResult>
}
