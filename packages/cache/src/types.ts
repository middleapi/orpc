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
}

export interface CacheSetOptions {
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
}

export interface CacheRevalidateOptions {
  /**
   * The tags to revalidate.
   */
  tags: readonly [string, ...string[]]
}

/**
 * Storage contract used by the cache middleware. Implementations own
 * expiry and tag tracking: `set` records tags, `revalidate` invalidates
 * every entry associated with them.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#basic-usage | Cache Helpers - Basic Usage}
 */
export interface CacheStore {
  /**
   * Resolves the entry stored under `key`, or `undefined` on miss/evicted/revalidated.
   * Stale entries (past `expiresAt` but within the stale-while-revalidate window) are returned.
   * Keys may be any serializable value; implementations encode them stably,
   * so structurally equal keys resolve the same entry.
   */
  get(key: unknown): Promise<CacheEntry | undefined>

  /**
   * Stores `output` under `key`, replacing any previous entry.
   */
  set(key: unknown, output: unknown, options?: CacheSetOptions): Promise<void>

  /**
   * Invalidates every entry associated with any of the given tags.
   */
  revalidate(options: CacheRevalidateOptions): Promise<void>

  /**
   * Runs `fn` for one caller at a time per key, so a miss is filled once
   * rather than once per concurrent caller. `waited` is `true` when another
   * caller held the lock first, so the entry may exist by now. Stores without
   * it let every caller fill.
   */
  lock?<T>(key: unknown, fn: (waited: boolean) => Promise<T>): Promise<T>
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
