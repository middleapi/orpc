import type { Middleware, MiddlewareOptions } from '@orpc/server'
import type { Promisable, Value } from '@orpc/shared'
import type { CacheHandlerPluginContext } from './handler-plugin'
import type { CacheContext } from './types'
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
   * Stale entries are served while the procedure re-executes to refresh the entry,
   * in the background through `cache/waitUntil` or before returning without it.
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

    const entry = await store.get(key)

    if (entry) {
      /**
       * The entry's remaining freshness, so reflected HTTP caching headers never
       * outlive the store entry. `0` means the entry is stale.
       */
      const remainingTtl = entry.expiresAt !== undefined ? Math.max(0, entry.expiresAt - nowInSeconds()) : undefined

      if (remainingTtl === 0) {
        const refresh = Promise.resolve(middlewareOptions.next())
          .then(result => store.set(key, result.output, { tags, ttl, swr }))

        const waitUntil = middlewareOptions.context['cache/waitUntil']

        if (waitUntil !== undefined) {
          // The runtime owns the refresh from here, failures included.
          waitUntil(refresh)
        }
        else {
          // Nothing else can own it, so the request waits for it; the stale output still stands if it fails.
          await refresh.catch(() => {})
        }
      }

      pluginContext?.caches.push({
        procedure: middlewareOptions.procedure,
        path: middlewareOptions.path,
        tags: entry.tags,
        ttl: remainingTtl,
        swr,
      })

      return done({ output: entry.output })
    }

    const result = await middlewareOptions.next()

    await store.set(key, result.output, { tags, ttl, swr })

    pluginContext?.caches.push({
      procedure: middlewareOptions.procedure,
      path: middlewareOptions.path,
      tags,
      ttl,
      swr,
    })

    return result
  }
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
