import type { Context, Middleware, MiddlewareOptions } from '@orpc/server'
import type { Promisable, Value } from '@orpc/shared'
import type { CacheHandlerPluginContext } from './handler-plugin'
import type { CacheContext } from './types'
import { RPCJsonSerializer } from '@orpc/client'
import { isAsyncIteratorObject, stringifyJSON, toArray, value } from '@orpc/shared'
import { CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL } from './handler-plugin'

/**
 * A cache key, or any serializable value to derive one from.
 * Kept as a wide union instead of `unknown` so callback parameters
 * stay contextually typed.
 */
export type CacheKeyMaterial = string | number | bigint | boolean | object | null | undefined

export interface CacheMiddlewareOptions<
  TInContext extends Context,
  TInput,
> {
  /**
   * The key identifying the cache entry, or any serializable value to derive
   * it from. Strings are used verbatim, while any other value is combined
   * with the procedure path and encoded into a key.
   *
   * @default the procedure path and input
   */
  key?: Value<Promisable<CacheKeyMaterial>, [options: MiddlewareOptions<TInContext & CacheContext, unknown, Record<never, never>>, input: TInput]>

  /**
   * Tags associated with the entry. Revalidating any of them invalidates the entry.
   *
   * @default []
   */
  tags?: Value<Promisable<readonly string[]>, [options: MiddlewareOptions<TInContext & CacheContext, unknown, Record<never, never>>, input: TInput]>

  /**
   * Fresh lifetime in milliseconds. `undefined` means the entry never expires by time.
   *
   * @default undefined
   */
  ttl?: Value<Promisable<number | undefined>, [options: MiddlewareOptions<TInContext & CacheContext, unknown, Record<never, never>>, input: TInput]>

  /**
   * Extra stale-while-revalidate window in milliseconds after `ttl`.
   * Stale entries are served immediately while the procedure re-executes in the background.
   *
   * @default 0
   */
  swr?: Value<Promisable<number | undefined>, [options: MiddlewareOptions<TInContext & CacheContext, unknown, Record<never, never>>, input: TInput]>

  /**
   * When resolved to `false`, skips both the cache lookup and the store for this request.
   *
   * @default true
   */
  enabled?: Value<Promisable<boolean>, [options: MiddlewareOptions<TInContext & CacheContext, unknown, Record<never, never>>, input: TInput]>
}

/**
 * Creates a middleware that caches procedure output in the `context.cache` store,
 * with tag-based revalidation and optional stale-while-revalidate.
 * By default the key is derived from the procedure path and input.
 * Streaming outputs (event iterators, readable streams) are never cached.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#cache-middleware | Cache Helpers - Cache Middleware}
 */
export function cache<
  TInContext extends Context,
  TInput,
>(
  options: CacheMiddlewareOptions<TInContext, TInput> = {},
): Middleware<TInContext & CacheContext, object, TInput, any, object> {
  return async function cache(middlewareOptions, input, done) {
    const [keyMaterial, tags = [], ttl, swr, enabled = true] = await Promise.all([
      options.key !== undefined ? value(options.key, middlewareOptions, input) : input,
      value(options.tags, middlewareOptions, input),
      value(options.ttl, middlewareOptions, input),
      value(options.swr, middlewareOptions, input),
      value(options.enabled, middlewareOptions, input),
    ])

    if (!enabled) {
      return middlewareOptions.next()
    }

    const key = typeof keyMaterial === 'string' ? keyMaterial : encodeCacheKey(middlewareOptions.path, keyMaterial)

    const { cache: store, waitUntil } = middlewareOptions.context as CacheContext
    const pluginContext = (middlewareOptions.context as CacheHandlerPluginContext)[CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]

    const entry = await store.get(key)

    if (entry) {
      const stale = entry.expiresAt !== undefined && Date.now() >= entry.expiresAt

      if (stale) {
        const refresh = Promise.resolve(middlewareOptions.next())
          .then(async (result) => {
            if (!isUncacheableOutput(result.output)) {
              await store.set(key, result.output, { tags, ttl, swr })
            }
          })
          .catch(() => {
            // A background refresh failure cannot affect the already-served
            // response; the next stale hit retries.
          })

        waitUntil?.(refresh)
      }

      pluginContext?.caches.push({
        procedure: middlewareOptions.procedure,
        path: middlewareOptions.path,
        hit: true,
        stale,
        key,
        tags: entry.tags,
        // The entry's remaining freshness, so reflected HTTP caching headers never
        // outlive the store entry.
        ttl: entry.expiresAt !== undefined ? Math.max(0, entry.expiresAt - Date.now()) : undefined,
        swr,
      })

      return done({ output: entry.output })
    }

    const result = await middlewareOptions.next()

    if (isUncacheableOutput(result.output)) {
      return result
    }

    await store.set(key, result.output, { tags, ttl, swr })

    pluginContext?.caches.push({
      procedure: middlewareOptions.procedure,
      path: middlewareOptions.path,
      hit: false,
      stale: false,
      key,
      tags,
      ttl,
      swr,
    })

    return result
  }
}

/**
 * Creates a middleware that revalidates cache tags in the `context.cache` store
 * after the procedure succeeds, typically on mutations. Errors skip the revalidation entirely.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#revalidate-middleware | Cache Helpers - Revalidate Middleware}
 */
export function revalidate<
  TInContext extends Context,
  TInput,
>(
  tags: Value<Promisable<string | readonly [string, ...string[]]>, [options: MiddlewareOptions<TInContext & CacheContext, unknown, Record<never, never>>, input: TInput]>,
): Middleware<TInContext & CacheContext, object, TInput, any, object> {
  return async function revalidate(middlewareOptions, input) {
    const result = await middlewareOptions.next()

    const resolvedTags = toArray(await value(tags, middlewareOptions, input))

    if (resolvedTags.length) {
      await (middlewareOptions.context as CacheContext).cache.revalidateTag(resolvedTags as [string, ...string[]])

      const pluginContext = (middlewareOptions.context as CacheHandlerPluginContext)[CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]
      pluginContext?.revalidations.push({
        procedure: middlewareOptions.procedure,
        path: middlewareOptions.path,
        tags: resolvedTags,
      })
    }

    return result
  }
}

function isUncacheableOutput(output: unknown): boolean {
  return isAsyncIteratorObject(output) || output instanceof ReadableStream
}

const cacheKeySerializer = new RPCJsonSerializer()

function encodeCacheKey(path: readonly string[], material: unknown): string {
  const { json, meta, blobs } = cacheKeySerializer.serialize(material)

  if (blobs?.length) {
    throw new TypeError('Cache key material must not contain Blob or File values; provide an explicit string key instead')
  }

  return stringifyJSON({ path, json, meta })
}
