import { toArray } from '@orpc/shared'
import type { StandardHeaders } from '@standard-server/core'
import { toFetchHeaders } from '@standard-server/fetch'

import type { StandardHandlerOptions, StandardHandlerPlugin } from '../adapters/standard/index'

function appendValidHeader(headers: Headers, name: string, value: string): void {
  try {
    headers.append(name, value)
  } catch {}
}

/**
 * Not every request passes through an HTTP parser: batch subrequests carry their headers
 * in the request body, so a client can send any header name or value.
 */
function toSafeFetchHeaders(standardHeaders: StandardHeaders): Headers {
  try {
    return toFetchHeaders(standardHeaders)
  } catch {
    const headers = new Headers()

    for (const name of Object.keys(standardHeaders)) {
      const value = standardHeaders[name]

      if (Array.isArray(value)) {
        for (const item of value) {
          appendValidHeader(headers, name, item)
        }
      } else if (value !== undefined) {
        appendValidHeader(headers, name, value)
      }
    }

    return headers
  }
}

/**
 * The context shape into which the Request Headers Plugin injects `reqHeaders`.
 *
 * @see {@link https://orpc.dev/docs/plugins/request-headers | Request Headers Plugin}
 */
export interface RequestHeadersHandlerPluginContext {
  /**
   * Request headers as a Headers instance. This is injected by the Request Headers Plugin.
   */
  reqHeaders?: Headers | undefined
}

/**
 * The Request Headers Plugin injects a `reqHeaders` instance into the context,
 * allowing access to request headers in oRPC.
 *
 * @see {@link https://orpc.dev/docs/plugins/request-headers | Request Headers Plugin}
 */
export class RequestHeadersHandlerPlugin<
  T extends RequestHeadersHandlerPluginContext,
> implements StandardHandlerPlugin<T> {
  readonly name = '~request-headers'

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    return {
      ...options,
      interceptors: [
        (interceptorOptions) => {
          const reqHeaders =
            interceptorOptions.context.reqHeaders ??
            toSafeFetchHeaders(interceptorOptions.request.headers)

          return interceptorOptions.next({
            ...interceptorOptions,
            context: {
              ...interceptorOptions.context,
              reqHeaders,
            },
          })
        },
        ...toArray(options.interceptors),
      ],
    }
  }
}
