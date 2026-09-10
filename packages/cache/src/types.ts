export interface CacheEntry {
  /**
   * The cached procedure output.
   */
  output: unknown

  /**
   * The tags recorded when the entry was stored, absent when it has none.
   */
  tags?: readonly string[] | undefined

  /**
   * The time (unix timestamp in seconds) when the entry stops being fresh.
   * `undefined` means the entry never becomes stale.
   */
  expiresAt?: number | undefined

  /**
   * The time (unix timestamp in seconds) after which the entry is no longer
   * served, once its stale-while-revalidate window has passed. `undefined`
   * means the entry never expires.
   */
  evictAt?: number | undefined
}

export interface CacheGetOrSetOptions {
  /**
   * Tags associated with the entry. Revalidating any of them invalidates the entry.
   *
   * @default []
   */
  tags?: readonly string[]

  /**
   * Fresh lifetime in seconds. `undefined` means the entry never expires by time.
   *
   * @default undefined
   */
  ttl?: number

  /**
   * Extra stale-while-revalidate window in seconds after `ttl`.
   * During this window the store still returns the entry with a past `expiresAt`.
   * Ignored when `ttl` is `undefined`.
   *
   * @default 0
   */
  swr?: number

  /**
   * Takes ownership of the background refresh of a stale entry, like
   * `ctx.waitUntil` on Cloudflare Workers. The promise rejects when the
   * refresh fails, so this is also where such failures are handled; without
   * it they surface as unhandled rejections.
   */
  waitUntil?: (promise: Promise<unknown>) => void
}

export interface CacheRevalidateOptions {
  /**
   * The tags to revalidate.
   */
  tags: readonly [string, ...string[]]
}

/**
 * Storage contract used by the cache middleware. Implementations own expiry,
 * tag tracking, and how concurrent callers of one key are coalesced.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#basic-usage | Cache Helpers - Basic Usage}
 */
export interface CacheStore {
  /**
   * Resolves the entry stored under `key`, filling it through `fill` when
   * there is none. Concurrent callers of one key fill once and share that
   * entry. A stale entry, past `expiresAt` but within `swr`, is returned as is
   * while one caller refreshes it in the background. Keys may be any
   * serializable value; implementations encode them stably, so structurally
   * equal keys resolve the same entry.
   */
  getOrSet(key: unknown, fill: () => Promise<unknown>, options?: CacheGetOrSetOptions): Promise<CacheEntry>

  /**
   * Invalidates every entry associated with any of the given tags.
   */
  revalidate(options: CacheRevalidateOptions): Promise<void>
}

/**
 * The context required by the cache and revalidate middlewares.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#basic-usage | Cache Helpers - Basic Usage}
 */
export interface CacheContext {
  /**
   * The cache store shared by every cached procedure behind one handler.
   */
  'cache/store': CacheStore

  /**
   * Takes ownership of background work such as stale-while-revalidate
   * refreshes, like `ctx.waitUntil` on Cloudflare Workers. The promise rejects
   * when the refresh fails, so this is also where such failures are handled;
   * without it they surface as unhandled rejections.
   */
  'cache/waitUntil'?: (promise: Promise<unknown>) => void
}
