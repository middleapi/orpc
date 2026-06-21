import type { StandardHandlerOptions, StandardHandlerPlugin } from '../adapters/standard'
import { toArray } from '@orpc/shared'
import { mergeStandardHeaders } from '@standardserver/core'
import { toStandardHeaders } from '@standardserver/fetch'

export interface ResponseHeadersHandlerPluginContext {
  /**
   * Response headers as a Headers instance. This is injected by the Response Headers Plugin.
   * When set before the response is sent, these headers will be included in the response. If not set, no additional headers will be added.
   */
  resHeaders?: Headers | undefined
}

/**
 * The Response Headers Plugin allows you to set response headers in oRPC.
 * It injects a resHeaders instance into the context, enabling you to modify response headers easily.
 *
 * @see {@link https://orpc.dev/docs/plugins/response-headers Response Headers Plugin Docs}
 */
export class ResponseHeadersHandlerPlugin<T extends ResponseHeadersHandlerPluginContext> implements StandardHandlerPlugin<T> {
  name = '~response-headers'
  /**
   * Interceptors should run after batch interceptors so headers are applied to each sub-response.
   */
  before = ['~batch']

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    return {
      ...options,
      routingInterceptors: [
        async (interceptorOptions) => {
          const resHeaders = new Headers(interceptorOptions.context.resHeaders)

          const result = await interceptorOptions.next({
            ...interceptorOptions,
            context: {
              ...interceptorOptions.context,
              resHeaders,
            },
          })

          if (!result.response) {
            return result
          }

          return {
            ...result,
            response: {
              ...result.response,
              headers: mergeStandardHeaders(result.response.headers, toStandardHeaders(resHeaders)),
            },
          }
        },
        ...toArray(options.routingInterceptors),
      ],
    }
  }
}
