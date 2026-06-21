import type { Context } from '@orpc/server'
import type { StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor } from '@orpc/server/standard'
import type { StandardHeaders } from '@standardserver/core'
import type { RateLimitResult } from './types'
import { toArray } from '@orpc/shared'

export const RATELIMIT_HANDLER_PLUGIN_CONTEXT_SYMBOL: unique symbol = Symbol.for('ORPC_RATELIMIT_HANDLER_PLUGIN_CONTEXT')

export interface RateLimitHandlerPluginContext {
  [RATELIMIT_HANDLER_PLUGIN_CONTEXT_SYMBOL]?: {
    /**
     * The result of the ratelimiter after applying limits
     */
    results: RateLimitResult[]
  }
}

/**
 * Automatically adds HTTP rate-limiting headers (RateLimit-* and Retry-After) to responses
 * when used with middleware created by createRatelimitMiddleware.
 *
 * @see {@link https://orpc.dev/docs/helpers/ratelimit#handler-plugin Ratelimit handler plugin}
 */
export class RateLimitHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~ratelimit'

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const routingInterceptor: StandardHandlerRoutingInterceptor<T> = async (interceptorOptions) => {
      const pluginContext: Exclude<RateLimitHandlerPluginContext[typeof RATELIMIT_HANDLER_PLUGIN_CONTEXT_SYMBOL], undefined> = { results: [] }

      const result = await interceptorOptions.next({
        ...interceptorOptions,
        context: {
          ...interceptorOptions.context,
          [RATELIMIT_HANDLER_PLUGIN_CONTEXT_SYMBOL]: pluginContext,
        } satisfies RateLimitHandlerPluginContext,
      })

      if (result.matched && pluginContext.results.length) {
        const exceededResults = pluginContext.results.filter(r => !r.success)

        // Pick the most constrained result: prefer exceeded limits, fall back to all results.
        // Treat undefined remaining as 0 — unknown capacity is assumed fully exhausted.
        const mostConstrained = (exceededResults.length ? exceededResults : pluginContext.results).reduce(
          (a, b) => (a.remaining ?? Infinity) <= (b.remaining ?? Infinity) ? a : b,
        )

        const headers: StandardHeaders = {
          ...result.response.headers,
          'ratelimit-limit': mostConstrained.limit?.toString(),
          'ratelimit-remaining': mostConstrained.remaining?.toString(),
          'ratelimit-reset': mostConstrained.reset?.toString(),
        }

        if (result.response.status >= 400 && !mostConstrained.success && mostConstrained.reset !== undefined) {
          headers['retry-after'] = Math.max(0, Math.ceil((mostConstrained.reset - Date.now()) / 1000)).toString()
        }

        return {
          ...result,
          response: {
            ...result.response,
            headers,
          },
        }
      }

      return result
    }

    return {
      ...options,
      routingInterceptors: [
        ...toArray(options.routingInterceptors),
        routingInterceptor,
      ],
    }
  }
}
