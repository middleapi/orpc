import type { Middleware, MiddlewareOptions } from '@orpc/server'
import type { Promisable, Value } from '@orpc/shared'
import { isDeepEqual, value } from '@orpc/shared'

import type { CacheHandlerPluginContext, CacheHandlerPluginLookup } from './handler-plugin'
import { CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL } from './handler-plugin'
import type { CacheContext, CacheEntry } from './types'

/**
 * The keys the `cache` middlewares further out on the procedure are filling.
 */
const OUTER_CACHE_KEYS_SYMBOL: unique symbol = Symbol('ORPC_OUTER_CACHE_KEYS')

type MiddlewareValue<T, TInContext extends CacheContext, TInput> = Value<
  Promisable<T>,
  [options: MiddlewareOptions<TInContext, unknown, Record<never, never>>, input: TInput]
>

export interface CacheMiddlewareOptions<TInContext extends CacheContext, TInput> {
  /**
   * The cache key, or any serializable value to derive it from.
   * Procedures sharing a key share an entry.
   *
   * @default the procedure path and input
   */
  // Spelled out instead of `unknown`, which absorbs the function form and drops its contextual typing.
  key?:
    | MiddlewareValue<
        string | number | bigint | boolean | object | null | undefined,
        TInContext,
        TInput
      >
    | undefined

  /**
   * Tags associated with the entry. Revalidating any of them invalidates the entry.
   *
   * @default []
   */
  tags?: MiddlewareValue<readonly string[], TInContext, TInput> | undefined

  /**
   * Fresh lifetime in milliseconds. `undefined` means the entry never expires by time.
   *
   * @default undefined
   */
  ttl?: MiddlewareValue<number | undefined, TInContext, TInput> | undefined

  /**
   * Extra stale-while-revalidate window in milliseconds after `ttl`.
   * Stale entries are served immediately while the procedure re-executes in the background.
   *
   * @default 0
   */
  swr?: MiddlewareValue<number | undefined, TInContext, TInput> | undefined

  /**
   * When resolved to `false`, skips both the cache lookup and the store for this request.
   *
   * @default true
   */
  enabled?: MiddlewareValue<boolean, TInContext, TInput> | undefined
}

/**
 * Creates a middleware that caches procedure output in the context's `cache/store`,
 * with tag-based revalidation and optional stale-while-revalidate.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#cache-middleware | Cache Helpers - Cache Middleware}
 */
export function cache<TInContext extends CacheContext, TInput>(
  options: CacheMiddlewareOptions<TInContext, TInput> = {},
): Middleware<TInContext, object, TInput, any, object> {
  return async function cache(middlewareOptions, input, done) {
    const { context, procedure, path } = middlewareOptions
    const pluginContext = (context as CacheHandlerPluginContext)[
      CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL
    ]
    const lookupIndex = pluginContext?.caches.length ?? 0

    // Recorded at its lookup position rather than appended, so the plugin finds the outermost of stacked caches first.
    const record = (lookup: Pick<CacheHandlerPluginLookup, 'tags' | 'ttl' | 'swr'>) => {
      pluginContext?.caches.splice(lookupIndex, 0, { procedure, path, ...lookup })
    }

    if ((await value(options.enabled, middlewareOptions, input)) === false) {
      const tags = await value(options.tags, middlewareOptions, input)
      const result = await middlewareOptions.next()

      // Still recorded with its tags, so clients tracking them revalidate the output.
      record({ tags, ttl: 0, swr: 0 })

      return result
    }

    const [key = [path, input], tags, ttl, swr] = await Promise.all([
      value(options.key, middlewareOptions, input),
      value(options.tags, middlewareOptions, input),
      value(options.ttl, middlewareOptions, input),
      value(options.swr, middlewareOptions, input),
    ])

    const outerKeys =
      (context as { [OUTER_CACHE_KEYS_SYMBOL]?: unknown[] })[OUTER_CACHE_KEYS_SYMBOL] ?? []

    // An outer cache is already filling this key, and waiting for its lock would stall.
    if (outerKeys.some((outerKey) => isDeepEqual(outerKey, key))) {
      return middlewareOptions.next()
    }

    const entry = await context['cache/store'].getOrSet(
      key,
      async () => {
        const result = await middlewareOptions.next({
          context: { [OUTER_CACHE_KEYS_SYMBOL]: [...outerKeys, key] },
        })

        return result.output
      },
      { tags, ttl, swr, waitUntil: context['cache/waitUntil'] },
    )

    record({ tags: entry.tags, ...remainingLifetime(entry) })

    return done({ output: entry.output })
  }
}

export interface RevalidateMiddlewareOptions<TInContext extends CacheContext, TInput> {
  /**
   * The tags to revalidate. Resolving to `null` or `undefined` skips the revalidation.
   */
  tags: MiddlewareValue<readonly [string, ...string[]] | null | undefined, TInContext, TInput>
}

/**
 * Creates a middleware that revalidates cache tags in the context's `cache/store`
 * after the procedure succeeds, typically on mutations.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#revalidate-middleware | Cache Helpers - Revalidate Middleware}
 */
export function revalidate<TInContext extends CacheContext, TInput>(
  options: RevalidateMiddlewareOptions<TInContext, TInput>,
): Middleware<TInContext, object, TInput, any, object> {
  return async function revalidate(middlewareOptions, input) {
    const result = await middlewareOptions.next()

    const tags = await value(options.tags, middlewareOptions, input)

    if (tags) {
      const store = middlewareOptions.context['cache/store']
      await store.revalidate({ tags })

      const pluginContext = (middlewareOptions.context as CacheHandlerPluginContext)[
        CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL
      ]
      pluginContext?.revalidations.push({
        procedure: middlewareOptions.procedure,
        path: middlewareOptions.path,
        tags,
      })
    }

    return result
  }
}

function remainingLifetime(entry: CacheEntry): {
  ttl: number | undefined
  swr: number | undefined
} {
  if (entry.expiresAt === undefined) {
    return { ttl: undefined, swr: undefined }
  }

  const now = Date.now()

  return {
    ttl: Math.max(0, entry.expiresAt - now),
    swr:
      entry.evictAt === undefined
        ? undefined
        : Math.max(0, entry.evictAt - Math.max(now, entry.expiresAt)),
  }
}
