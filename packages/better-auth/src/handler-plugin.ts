import type { Context } from '@orpc/server'
import type { StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor } from '@orpc/server/standard'
import type { BetterAuthContext } from './context'
import { toArray } from '@orpc/shared'
import { mergeStandardHeaders } from '@standard-server/core'
import { toFetchHeaders } from '@standard-server/fetch'
import { BETTER_AUTH_CONTEXT_SYMBOL, createBetterAuthRequestState } from './context'

/**
 * Gives the session middlewares access to the request headers, applies `set-cookie` headers
 * returned by session lookups (refreshed session and cookie cache) to the response,
 * and shares session lookups across batch subrequests.
 *
 * @see {@link https://orpc.dev/docs/integrations/better-auth | Better Auth Integration}
 */
export class BetterAuthHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~better-auth'

  /**
   * - Do not create spans for this plugin's interceptor.
   * - Run before batch interceptors so session lookups are shared by all subrequests
   *   and collected cookies are applied to the actual response rather than sub-responses.
   */
  after = ['~tracing', '~batch']

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const routingInterceptor: StandardHandlerRoutingInterceptor<T> = async ({ next, ...interceptorOptions }) => {
      const state = (interceptorOptions.context as BetterAuthContext)[BETTER_AUTH_CONTEXT_SYMBOL]
        ?? createBetterAuthRequestState(() => toFetchHeaders(interceptorOptions.request.headers))

      const result = await next({
        ...interceptorOptions,
        context: {
          ...interceptorOptions.context,
          [BETTER_AUTH_CONTEXT_SYMBOL]: state,
        } satisfies BetterAuthContext,
      })

      if (!result.matched) {
        return result
      }

      /**
       * Take the collected cookies out of the state, so a state shared with an outer handler
       * does not apply the same cookies twice.
       */
      const setCookies = state.setCookies.splice(0)

      if (!setCookies.length) {
        return result
      }

      return {
        ...result,
        response: {
          ...result.response,
          headers: mergeStandardHeaders(result.response.headers, { 'set-cookie': setCookies }),
        },
      }
    }

    return {
      ...options,
      routingInterceptors: [
        routingInterceptor,
        ...toArray(options.routingInterceptors),
      ],
    }
  }
}
