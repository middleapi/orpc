import type { Middleware, MiddlewareOptions } from '@orpc/server'
import type { Promisable, Value } from '@orpc/shared'
import type { CacheHandlerPluginContext } from './handler-plugin'
import type { CacheContext, CacheEntry } from './types'
import { value } from '@orpc/shared'
import { CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL } from './handler-plugin'

export interface CacheMiddlewareOptions<
  TInContext extends CacheContext,
  TInput,
> {
  /**
   * The key identifying the cache entry, or any serializable value to derive
   * it from. Used as given, so procedures sharing a key share an entry;
   * `undefined` falls back to the default.
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
   * Fresh lifetime in milliseconds. `undefined` means the entry never expires by time.
   *
   * @default undefined
   */
  ttl?: Value<Promisable<number | undefined>, [options: MiddlewareOptions<TInContext, unknown, Record<never, never>>, input: TInput]>

  /**
   * Extra stale-while-revalidate window in milliseconds after `ttl`.
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
    if (await value(options.enabled, middlewareOptions, input) === false) {
      return middlewareOptions.next()
    }

    const [key = [middlewareOptions.path, input], tags, ttl, swr] = await Promise.all([
      value(options.key, middlewareOptions, input),
      value(options.tags, middlewareOptions, input),
      value(options.ttl, middlewareOptions, input),
      value(options.swr, middlewareOptions, input),
    ])

    const store = middlewareOptions.context['cache/store']
    const pluginContext = (middlewareOptions.context as CacheHandlerPluginContext)[CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]
    const lookupIndex = pluginContext?.caches.length ?? 0

    const entry = await store.getOrSet(key, async () => (await middlewareOptions.next()).output, {
      tags,
      ttl,
      swr,
      waitUntil: middlewareOptions.context['cache/waitUntil'],
    })

    // Recorded at its lookup position rather than appended, so the plugin finds the outermost of stacked caches first.
    pluginContext?.caches.splice(lookupIndex, 0, {
      procedure: middlewareOptions.procedure,
      path: middlewareOptions.path,
      tags: entry.tags,
      ...remainingLifetime(entry),
    })

    return done({ output: entry.output })
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

/**
 * What is left of the entry's fresh lifetime and swr window, in milliseconds.
 */
function remainingLifetime(entry: CacheEntry): { ttl: number | undefined, swr: number | undefined } {
  if (entry.expiresAt === undefined) {
    return { ttl: undefined, swr: undefined }
  }

  const now = Date.now()

  return {
    ttl: Math.max(0, entry.expiresAt - now),
    swr: entry.evictAt === undefined ? undefined : Math.max(0, entry.evictAt - Math.max(now, entry.expiresAt)),
  }
}
