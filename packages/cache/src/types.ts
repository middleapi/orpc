export interface CacheEntry {
  output: unknown

  /**
   * The tags recorded when the entry was stored, absent when it has none.
   */
  tags?: readonly string[] | undefined

  /**
   * The time (unix timestamp in milliseconds) when the entry stops being fresh.
   * `undefined` means the entry never becomes stale.
   */
  expiresAt?: number | undefined

  /**
   * The time (unix timestamp in milliseconds) after which the entry is no
   * longer served. `undefined` means it never expires.
   */
  evictAt?: number | undefined
}

export interface CacheGetOrSetOptions {
  /**
   * Tags associated with the entry. Revalidating any of them invalidates the entry.
   *
   * @default []
   */
  tags?: readonly string[] | undefined

  /**
   * Fresh lifetime in milliseconds. `undefined` means the entry never expires by time.
   *
   * @default undefined
   */
  ttl?: number | undefined

  /**
   * Extra stale-while-revalidate window in milliseconds after `ttl`.
   * During this window the store still returns the entry with a past `expiresAt`.
   * Ignored when `ttl` is `undefined`.
   *
   * @default 0
   */
  swr?: number | undefined

  /**
   * Takes ownership of the background refresh of a stale entry, like
   * `ctx.waitUntil` on Cloudflare Workers. The promise rejects when the
   * refresh fails, so this is also where such failures are handled; without
   * it they surface as unhandled rejections.
   */
  waitUntil?: ((promise: Promise<unknown>) => void) | undefined
}

export interface CacheRevalidateOptions {
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
   * Resolves the entry under `key`, filling it through `fill` on a miss.
   * Concurrent callers of one key share one fill, and a stale entry within
   * `swr` is returned while one caller refreshes it. A lifetime of zero stores
   * nothing. Keys may be any serializable value.
   */
  getOrSet(
    key: unknown,
    fill: () => Promise<unknown>,
    options?: CacheGetOrSetOptions,
  ): Promise<CacheEntry>

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
   * refreshes, passed to the store as {@link CacheGetOrSetOptions.waitUntil}.
   */
  'cache/waitUntil'?: ((promise: Promise<unknown>) => void) | undefined
}
