import type { StandardHeaders } from '@orpc/standard-server'
import type { StandardHandlerOptions, StandardHandlerPlugin } from '../adapters/standard'
import { toFetchHeaders } from '@orpc/standard-server-fetch'

export interface RequestHeadersPluginContext {
  reqHeaders?: Headers
}

function appendValidHeader(headers: Headers, name: string, value: string): void {
  try {
    headers.append(name, value)
  }
  catch {}
}

/**
 * Not every request passes through an HTTP parser: batch subrequests carry their headers
 * in the request body, so a client can send any header name or value.
 */
function toSafeFetchHeaders(standardHeaders: StandardHeaders): Headers {
  try {
    return toFetchHeaders(standardHeaders)
  }
  catch {
    const headers = new Headers()

    for (const name of Object.keys(standardHeaders)) {
      const value = standardHeaders[name]

      if (Array.isArray(value)) {
        for (const item of value) {
          appendValidHeader(headers, name, item)
        }
      }
      else if (value !== undefined) {
        appendValidHeader(headers, name, value)
      }
    }

    return headers
  }
}

/**
 * The Request Headers Plugin injects a `reqHeaders` instance into the context,
 * allowing access to request headers in oRPC.
 *
 * @see {@link https://orpc.dev/docs/plugins/request-headers Request Headers Plugin Docs}
 */
export class RequestHeadersPlugin<T extends RequestHeadersPluginContext> implements StandardHandlerPlugin<T> {
  init(options: StandardHandlerOptions<T>): void {
    options.rootInterceptors ??= []

    options.rootInterceptors.push((interceptorOptions) => {
      const reqHeaders = interceptorOptions.context.reqHeaders ?? toSafeFetchHeaders(interceptorOptions.request.headers)

      return interceptorOptions.next({
        ...interceptorOptions,
        context: {
          ...interceptorOptions.context,
          reqHeaders,
        },
      })
    })
  }
}
