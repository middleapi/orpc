import type { Middleware, MiddlewareOptions } from '@orpc/server'
import type { Promisable, Value } from '@orpc/shared'
import type { CacheHandlerPluginContext } from './handler-plugin'
import type { CacheContext, CacheEntry, CacheStore } from './types'
import { nowInSeconds, value } from '@orpc/shared'
import { CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL } from './handler-plugin'

export interface CacheMiddlewareOptions<
  TInContext extends CacheContext,
  TInput,
> {
  /**
   * The key identifying the cache entry, or any serializable value to derive
   * it from. Used as given, so procedures sharing a key share an entry.
   *
   * @default the procedure path and input
   */
  // Spelled out instead of `unknown`, which absorbs the function form and drops its contextual typing.
  key?: Value<Promisable<string | number | bigint | boolean | object | null | undefined>, [options: MiddlewareOptions<TInContext, unknown, Record<never, never>>, input: TInput]>

  /**
   * Tags associated with the entry. Revalidating any of them invalidates the entry.
   *
   * @default []
   */
  tags?: Value<Promisable<readonly string[]>, [options: MiddlewareOptions<TInContext, unknown, Record<never, never>>, input: TInput]>

  /**
   * Fresh lifetime in seconds. `undefined` means the entry never expires by time.
   *
   * @default undefined
   */
  ttl?: Value<Promisable<number | undefined>, [options: MiddlewareOptions<TInContext, unknown, Record<never, never>>, input: TInput]>

  /**
   * Extra stale-while-revalidate window in seconds after `ttl`.
   * Stale entries are served immediately while the procedure re-executes in the background.
   *
   * @default 0
   */
  swr?: Value<Promisable<number | undefined>, [options: MiddlewareOptions<TInContext, unknown, Record<never, never>>, input: TInput]>

  /**
   * When resolved to `false`, skips both the cache lookup and the store for this request.
   *
   * @default true
   */
  enabled?: Value<Promisable<boolean>, [options: MiddlewareOptions<TInContext, unknown, Record<never, never>>, input: TInput]>
}

/**
 * Creates a middleware that caches procedure output in the context's `cache/store`,
 * with tag-based revalidation and optional stale-while-revalidate.
 * By default the key is derived from the procedure path and input.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#cache-middleware | Cache Helpers - Cache Middleware}
 */
export function cache<
  TInContext extends CacheContext,
  TInput,
>(
  options: CacheMiddlewareOptions<TInContext, TInput> = {},
): Middleware<TInContext, object, TInput, any, object> {
  return async function cache(middlewareOptions, input, done) {
    const [keyMaterial, tags, ttl, swr, enabled = true] = await Promise.all([
      value(options.key, middlewareOptions, input),
      value(options.tags, middlewareOptions, input),
      value(options.ttl, middlewareOptions, input),
      value(options.swr, middlewareOptions, input),
      value(options.enabled, middlewareOptions, input),
    ])

    if (!enabled) {
      return middlewareOptions.next()
    }

    const key = 'key' in options ? keyMaterial : [middlewareOptions.path, input]

    const store = middlewareOptions.context['cache/store']
    const pluginContext = (middlewareOptions.context as CacheHandlerPluginContext)[CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]

    const fill = async () => {
      const result = await middlewareOptions.next()
      await store.set(key, result.output, { tags, ttl, swr })
      return result
    }

    const serve = (entry: CacheEntry) => {
      const remainingTtl = remainingTtlOf(entry)

      if (remainingTtl === 0) {
        const refresh = lock(store, key, async (waited) => {
          if (waited) {
            // Whoever held the lock first may have refreshed the entry already.
            const current = await store.get(key)

            if (current !== undefined && remainingTtlOf(current) !== 0) {
              return
            }
          }

          await fill()
        })

        // Whatever owns background work owns the refresh from here, failures included.
        middlewareOptions.context['cache/waitUntil']?.(refresh)
      }

      pluginContext?.caches.push({
        procedure: middlewareOptions.procedure,
        path: middlewareOptions.path,
        tags: entry.tags,
        // Reflected HTTP caching headers must never outlive the store entry.
        ttl: remainingTtl,
        swr,
      })

      return done({ output: entry.output })
    }

    const entry = await store.get(key)

    if (entry) {
      return serve(entry)
    }

    return lock(store, key, async (waited) => {
      if (waited) {
        // Whoever held the lock first may have filled the entry already.
        const entry = await store.get(key)

        if (entry) {
          return serve(entry)
        }
      }

      const result = await fill()

      pluginContext?.caches.push({
        procedure: middlewareOptions.procedure,
        path: middlewareOptions.path,
        tags,
        ttl,
        swr,
      })

      return result
    })
  }
}

/**
 * Runs `fn` under the store's per-key lock when it has one, so concurrent
 * callers fill an entry once; otherwise every caller fills.
 */
function lock<T>(store: CacheStore, key: unknown, fn: (waited: boolean) => Promise<T>): Promise<T> {
  return store.lock !== undefined ? store.lock(key, fn) : fn(false)
}

/**
 * The entry's remaining freshness in seconds: `0` once it is stale and
 * `undefined` when it never expires.
 */
function remainingTtlOf(entry: CacheEntry): number | undefined {
  return entry.expiresAt !== undefined ? Math.max(0, entry.expiresAt - nowInSeconds()) : undefined
}

export interface RevalidateMiddlewareOptions<
  TInContext extends CacheContext,
  TInput,
> {
  /**
   * The tags to revalidate. Resolving to `null` or `undefined` skips the revalidation.
   */
  tags: Value<Promisable<readonly [string, ...string[]] | null | undefined>, [options: MiddlewareOptions<TInContext, unknown, Record<never, never>>, input: TInput]>
}

/**
 * Creates a middleware that revalidates cache tags in the context's `cache/store`
 * after the procedure succeeds, typically on mutations. Errors skip the revalidation entirely.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#revalidate-middleware | Cache Helpers - Revalidate Middleware}
 */
export function revalidate<
  TInContext extends CacheContext,
  TInput,
>(
  options: RevalidateMiddlewareOptions<TInContext, TInput>,
): Middleware<TInContext, object, TInput, any, object> {
  return async function revalidate(middlewareOptions, input) {
    const result = await middlewareOptions.next()

    const tags = await value(options.tags, middlewareOptions, input)

    if (tags) {
      const store = middlewareOptions.context['cache/store']
      await store.revalidate({ tags })

      const pluginContext = (middlewareOptions.context as CacheHandlerPluginContext)[CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]
      pluginContext?.revalidations.push({
        procedure: middlewareOptions.procedure,
        path: middlewareOptions.path,
        tags,
      })
    }

    return result
  }
}
