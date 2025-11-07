import type { Context } from '@orpc/server'
import type { StandardHandlerOptions, StandardHandlerPlugin } from '@orpc/server/standard'
import type { RatelimiterLimitResult } from './types'
import { COMMON_ORPC_ERROR_DEFS } from '@orpc/client'

export const RATELIMIT_HANDLER_CONTEXT_SYMBOL: unique symbol = Symbol('ORPC_RATE_LIMIT_HANDLER_CONTEXT')

export interface RatelimitHandlerPluginContext {
  [RATELIMIT_HANDLER_CONTEXT_SYMBOL]?: {
    /**
     * The result of the ratelimiter after applying limits
     */
    ratelimitResult?: RatelimiterLimitResult
  }
}

/**
 * Automatically adds HTTP rate-limiting headers (RateLimit-* and Retry-After) to responses
 * when used with middleware created by createRatelimitMiddleware.
 *
 * @see {@link https://orpc.unnoq.com/docs/helpers/ratelimit#handler-plugin Ratelimit handler plugin}
 */
export class RatelimitHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  init(options: StandardHandlerOptions<T>): void {
    options.rootInterceptors ??= []

    /**
     * This plugin should set headers before "response headers" plugin or user defined interceptors
     * In case user wants to override ratelimit headers
     */
    options.rootInterceptors.unshift(async (interceptorOptions) => {
      const handlerContext: Exclude<RatelimitHandlerPluginContext[typeof RATELIMIT_HANDLER_CONTEXT_SYMBOL], undefined> = {}

      const result = await interceptorOptions.next({
        ...interceptorOptions,
        context: {
          ...interceptorOptions.context,
          [RATELIMIT_HANDLER_CONTEXT_SYMBOL]: handlerContext,
        },
      })

      if (result.matched && handlerContext.ratelimitResult) {
        return {
          ...result,
          response: {
            ...result.response,
            headers: {
              ...result.response.headers,
              'ratelimit-limit': handlerContext.ratelimitResult.limit?.toString(),
              'ratelimit-remaining': handlerContext.ratelimitResult.remaining?.toString(),
              'ratelimit-reset': handlerContext.ratelimitResult.reset?.toString(),
              'retry-after': !handlerContext.ratelimitResult.success && result.response.status === COMMON_ORPC_ERROR_DEFS.TOO_MANY_REQUESTS.status && handlerContext.ratelimitResult.reset !== undefined
                ? Math.max(0, Math.ceil((handlerContext.ratelimitResult.reset - Date.now()) / 1000)).toString()
                : undefined,
            },
          },
        }
      }

      return result
    })
  }
}
