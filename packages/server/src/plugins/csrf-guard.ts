import type { StandardHandlerInterceptor, StandardHandlerOptions, StandardHandlerPlugin } from '../adapters/standard'
import type { Context } from '../context'
import { ORPCError } from '@orpc/client'
import { toArray } from '@orpc/shared'
import { flattenStandardHeader } from '@standardserver/core'

/**
 * Adds basic Cross-Site Request Forgery (CSRF) protection to your oRPC application.
 * When a request includes cookies, it helps ensure the request originates from JavaScript
 * (for example, fetch/XHR) rather than from standard HTML forms or direct browser navigation.
 *
 * @info This plugin is enabled by default for `RPCHandler` over HTTP.
 */
export class CSRFGuardHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~csrf-guard'

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const interceptor: StandardHandlerInterceptor<T> = async (interceptorOptions) => {
      const mode = flattenStandardHeader(
        interceptorOptions.request.headers['sec-fetch-mode'],
      )?.toLowerCase()

      // Non-browser clients (curl, mobile, server) — no Sec-Fetch-* headers
      if (mode === undefined) {
        return interceptorOptions.next()
      }

      // JS fetch/XHR/websocket
      if (mode === 'cors' || mode === 'same-origin') {
        return interceptorOptions.next()
      }

      // navigate, no-cors, websocket — block (form submits, img tags, navigation, etc.)
      throw new ORPCError('FORBIDDEN', {
        message: 'Request blocked by CSRF protection.',
      })
    }

    return {
      ...options,
      // appended last so user's interceptors can catch ORPCError
      interceptors: [...toArray(options.interceptors), interceptor],
    }
  }
}
