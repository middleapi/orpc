import type { Promisable, Value } from '@orpc/shared'
import type { StandardLinkOptions, StandardLinkPlugin, StandardLinkTransportInterceptor, StandardLinkTransportInterceptorOptions } from '../adapters/standard'
import type { ClientContext } from '../types'
import { toArray, value } from '@orpc/shared'

export interface CookiesManagementLinkPluginOptions<T extends ClientContext> {
  /**
   * Returns the `cookie` header value to send with each request,
   * or `undefined`/empty string to send none.
   *
   * @remarks
   * **Note**: A `cookie` header already present on the request is kept, and this function is not called.
   */
  getCookie: Value<Promisable<string | undefined>, [options: StandardLinkTransportInterceptorOptions<T>]>

  /**
   * Receives the `set-cookie` values of each response that has any.
   * The response is returned only after it settles, so the next request sees the stored cookies.
   */
  setCookie?: (cookies: string[], options: StandardLinkTransportInterceptorOptions<T>) => Promisable<void>
}

/**
 * Sends cookies from a custom store and reports cookies set by the server,
 * for clients without a built-in cookie jar such as React Native, Expo, or Node.js.
 *
 * @see {@link https://orpc.dev/docs/plugins/cookies-management | Cookies Management Plugin}
 */
export class CookiesManagementLinkPlugin<T extends ClientContext> implements StandardLinkPlugin<T> {
  private readonly getCookie: CookiesManagementLinkPluginOptions<T>['getCookie']
  private readonly setCookie: CookiesManagementLinkPluginOptions<T>['setCookie']

  name = '~cookies-management'

  /**
   * Cookies belong to the actual HTTP request, so run after batching
   * to read and store them once per batch request instead of once per subrequest.
   */
  after = ['~batch']

  constructor(options: NoInfer<CookiesManagementLinkPluginOptions<T>>) {
    this.getCookie = options.getCookie
    this.setCookie = options.setCookie
  }

  init(options: StandardLinkOptions<T>): StandardLinkOptions<T> {
    const transportInterceptor: StandardLinkTransportInterceptor<T> = async ({ next, ...interceptorOptions }) => {
      let request = interceptorOptions.request

      if (request.headers.cookie === undefined) {
        const cookie = await value(this.getCookie, interceptorOptions)

        if (cookie) {
          request = { ...request, headers: { ...request.headers, cookie } }
        }
      }

      const response = await next({ ...interceptorOptions, request })

      const setCookies = toArray(response.headers['set-cookie'])

      if (this.setCookie && setCookies.length) {
        await this.setCookie(setCookies, interceptorOptions)
      }

      return response
    }

    return {
      ...options,
      transportInterceptors: [
        ...toArray(options.transportInterceptors),
        transportInterceptor,
      ],
    }
  }
}
