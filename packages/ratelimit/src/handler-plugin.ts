import type { Context } from '@orpc/server'
import type { StandardHandlerOptions, StandardHandlerPlugin } from '@orpc/server/standard'
import type { RatelimiterLimitResult } from './types'

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
 * Handler plugin that automatically adds rate limit headers to responses.
 *
 * This plugin intercepts all requests and adds the following headers based on the rate limit result:
 * - `ratelimit-limit`: Maximum number of requests allowed within a window
 * - `ratelimit-remaining`: Number of requests remaining in the current window
 * - `ratelimit-reset`: Unix timestamp (ms) when the rate limit resets
 * - `retry-after`: Seconds to wait before retrying (only for 429 responses)
 *
 * The plugin must be used in conjunction with the ratelimit middleware to function properly.
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
              'retry-after': !handlerContext.ratelimitResult.success && result.response.status === 429 && handlerContext.ratelimitResult.reset !== undefined
                ? Math.ceil((handlerContext.ratelimitResult.reset - Date.now()) / 1000).toString()
                : undefined,
            },
          },
        }
      }

      return result
    })
  }
}
