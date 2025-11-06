import type { Context } from '@orpc/server'
import type { StandardHandlerOptions, StandardHandlerPlugin } from '@orpc/server/standard'
import type { RatelimiterLimitResult } from './types'

export const RATELIMIT_HANDLER_CONTEXT_SYMBOL = Symbol('ORPC_RATE_LIMIT_HANDLER_CONTEXT')

export interface RatelimitHandlerPluginContext {
  /**
   * The result of the ratelimiter after applying limits
   */
  ratelimitResult?: RatelimiterLimitResult
}

export class RatelimitHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  /**
   * this plugin should lower priority than response headers plugin,
   * if user want override rate limit headers
   */
  order = 100_000

  init(options: StandardHandlerOptions<T>): void {
    options.rootInterceptors ??= []

    options.rootInterceptors.push(async (interceptorOptions) => {
      const handlerContext: RatelimitHandlerPluginContext = {}

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
              'rateLimit-limit': handlerContext.ratelimitResult.limit?.toString(),
              'rateLimit-remaining': handlerContext.ratelimitResult.remaining?.toString(),
              'rateLimit-reset': handlerContext.ratelimitResult.reset?.toString(),
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
