/**
 * A cached procedure output alongside its metadata.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#basic-usage | Cache Helpers - Basic Usage}
 */
export interface CacheEntry {
  /**
   * The cached procedure output.
   */
  output: unknown

  /**
   * The tags recorded when the entry was stored.
   */
  tags: readonly string[]

  /**
   * The time (unix timestamp in milliseconds) when the entry stops being fresh.
   * `undefined` means the entry never becomes stale.
   */
  expiresAt?: number | undefined
}

/**
 * Options accepted by {@link CacheStore.set}.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#basic-usage | Cache Helpers - Basic Usage}
 */
export interface CacheSetOptions {
  /**
   * Tags associated with the entry. Revalidating any of them invalidates the entry.
   *
   * @default []
   */
  tags?: readonly string[]

  /**
   * Fresh lifetime in milliseconds. `undefined` means the entry never expires by time.
   *
   * @default undefined
   */
  ttl?: number

  /**
   * Extra stale-while-revalidate window in milliseconds after `ttl`.
   * During this window the store still returns the entry with a past `expiresAt`.
   * Ignored when `ttl` is `undefined`.
   *
   * @default 0
   */
  swr?: number
}

/**
 * Storage contract used by the cache middleware. Implementations own
 * expiry and tag tracking: `set` records tags, `revalidateTag` invalidates
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
   * Invalidates every entry associated with one or many tags.
   */
  revalidateTag(tag: string | readonly [string, ...string[]]): Promise<void>
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
  cache: CacheStore

  /**
   * Extends the request lifetime for background work such as
   * stale-while-revalidate refreshes. Required on runtimes that kill pending
   * work once the response is sent, like Cloudflare Workers (`ctx.waitUntil`).
   */
  waitUntil?: (promise: Promise<unknown>) => void
}
