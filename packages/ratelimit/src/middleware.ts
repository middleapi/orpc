import type { Context, Meta, Middleware, MiddlewareOptions } from '@orpc/server'
import type { Promisable, Value } from '@orpc/shared'
import type { RatelimitHandlerPluginContext } from './handler-plugin'
import type { Ratelimiter } from './types'
import { ORPCError } from '@orpc/server'
import { toArray, value } from '@orpc/shared'
import { RATELIMIT_HANDLER_CONTEXT_SYMBOL } from './handler-plugin'

export const RATELIMIT_MIDDLEWARE_CONTEXT_SYMBOL: unique symbol = Symbol('ORPC_RATE_LIMIT_MIDDLEWARE_CONTEXT')

export interface RatelimiterMiddlewareContext {
  [RATELIMIT_MIDDLEWARE_CONTEXT_SYMBOL]?: {
    /**
     * The applied limits in this request, mainly for deduplication purposes
     */
    limits: { limiter: Ratelimiter, key: string }[]
  }
}

export interface CreateRatelimitMiddlewareOptions<
  TInContext extends Context,
  TInput,
  TMeta extends Meta,
> {
  /**
   * The rule set to use for rate limiting
   */
  limiter: Value<Promisable<Ratelimiter>, [middlewareOptions: MiddlewareOptions<TInContext, unknown, Record<never, never>, TMeta>, input: TInput]>

  /**
   * The key to identify the user/requester
   */
  key: Value<Promisable<string>, [middlewareOptions: MiddlewareOptions<TInContext, unknown, Record<never, never>, TMeta>, input: TInput]>
  /**
   * If your ratelimit middleware is used multiple times
   * or you invoke a procedure inside another procedure (shared the same context) that also has
   * ratelimit middleware **with the same limiter and key**, this option
   * will ensure that the limit is only applied once per request.
   *
   * @default true
   */
  dedupe?: boolean
}

/**
 * Creates a middleware that enforces rate limits in oRPC procedures.
 * Supports per-request deduplication and integrates with the ratelimit handler plugin.
 *
 * @see {@link https://orpc.unnoq.com/docs/helpers/ratelimit#createratelimitmiddleware Ratelimit middleware}
 */
export function createRatelimitMiddleware<
  TInContext extends Context,
  TInput = unknown,
  TMeta extends Meta = Record<never, never>,
>(
  { dedupe = true, ...options }: CreateRatelimitMiddlewareOptions<TInContext, TInput, TMeta>,
): Middleware<TInContext, Record<never, never>, TInput, any, any, TMeta> {
  return async function ratelimit(middlewareOptions, input) {
    const [limiter, key] = await Promise.all([
      value(options.limiter, middlewareOptions, input),
      value(options.key, middlewareOptions, input),
    ])

    const middlewareContext = (middlewareOptions.context as RatelimiterMiddlewareContext)[RATELIMIT_MIDDLEWARE_CONTEXT_SYMBOL]
    if (dedupe && middlewareContext?.limits.some(l => l.key === key && l.limiter === limiter)) {
      return middlewareOptions.next()
    }

    const result = await limiter.limit(key)

    const pluginContext = (middlewareOptions.context as RatelimitHandlerPluginContext)[RATELIMIT_HANDLER_CONTEXT_SYMBOL]
    if (pluginContext) {
      pluginContext.ratelimitResult = result
    }

    if (!result.success) {
      throw new ORPCError('TOO_MANY_REQUESTS', {
        data: {
          limit: result.limit,
          remaining: result.remaining,
          reset: result.reset,
        },
      })
    }

    return middlewareOptions.next({
      context: {
        [RATELIMIT_MIDDLEWARE_CONTEXT_SYMBOL]: {
          ...middlewareContext,
          limits: [
            ...toArray(middlewareContext?.limits),
            { limiter, key },
          ],
        },
      },
    })
  }
}
