import type { Promisable, Value } from '@orpc/shared'
import type { StandardHeaders } from '@standard-server/core'
import type { StandardLinkOptions, StandardLinkPlugin, StandardLinkTransportInterceptor, StandardLinkTransportInterceptorOptions } from '../adapters/standard'
import type { ClientContext, ClientOptions } from '../types'
import type { StoredCookie } from './cookie-jar'
import { toArray, value } from '@orpc/shared'
import { CookieJar } from './cookie-jar'

export interface CookiesManagementLinkPluginOptions<T extends ClientContext> {
  /**
   * The jar that stores cookies between calls.
   * Pass your own to share it between links or to read and clear its cookies,
   * or a function to pick a jar per request, for example from the client context.
   *
   * @default A new `CookieJar` for each plugin instance
   */
  jar?: Value<CookieJar, [options: StandardLinkTransportInterceptorOptions<T>]> | undefined

  /**
   * The origin requests are sent to, used to match the `Domain` and `Secure` cookie attributes like a browser.
   * Use the same value as the link's `origin` option.
   *
   * Without it, every request counts as going to the same secure site:
   * `Domain` is not checked and `Secure` cookies are always sent.
   *
   * @example 'https://api.example.com'
   */
  origin?: Value<Promisable<`https://${string}` | `http://${string}` | ({} & string) | undefined>, [options: ClientOptions<T>, path: string[]]> | undefined
}

/**
 * Stores the cookies servers set and sends them back on later requests, like a browser does,
 * for clients without a cookie store such as server-side rendering, scripts, and tests.
 *
 * @remarks
 * **Warning**: The cookies belong to the link, like a browser profile belongs to one user.
 * On a server, do not share one link between users: create a client per incoming request, or pick a jar per request.
 *
 * @see {@link https://orpc.dev/docs/plugins/cookies-management | Cookies Management Plugin}
 */
export class CookiesManagementLinkPlugin<T extends ClientContext> implements StandardLinkPlugin<T> {
  private readonly jar: Exclude<CookiesManagementLinkPluginOptions<T>['jar'], undefined>
  private readonly origin: CookiesManagementLinkPluginOptions<T>['origin']

  name = '~cookies-management'

  /**
   * Cookies belong to the actual HTTP request, so handle them after batching,
   * once per batch request instead of once per subrequest, like a browser would see it.
   */
  after: string[] = ['~batch']

  constructor(options: NoInfer<CookiesManagementLinkPluginOptions<T>> = {}) {
    this.jar = options.jar ?? new CookieJar()
    this.origin = options.origin
  }

  init(options: StandardLinkOptions<T>): StandardLinkOptions<T> {
    const transportInterceptor: StandardLinkTransportInterceptor<T> = async ({ next, ...interceptorOptions }) => {
      const { path, request } = interceptorOptions
      const jar = value(this.jar, interceptorOptions)

      let origin = await value(this.origin, interceptorOptions, path)
      if (origin?.endsWith('/')) {
        origin = origin.slice(0, -1)
      }

      const url = `${origin ?? ''}${request.url}`
      const cookie = mergeCookieHeader(request.headers.cookie, jar.getCookies(url))

      const response = await next(
        cookie === undefined
          ? interceptorOptions
          : { ...interceptorOptions, request: { ...request, headers: { ...request.headers, cookie } } },
      )

      for (const setCookie of toArray(response.headers['set-cookie'])) {
        jar.setCookie(setCookie, url)
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

/**
 * Appends the jar cookies to a `cookie` header set elsewhere, such as through the link's `headers` option.
 * Cookies already in that header win over jar cookies with the same name.
 *
 * Returns `undefined` when the jar has nothing to add.
 */
function mergeCookieHeader(header: StandardHeaders[string], cookies: StoredCookie[]): string | undefined {
  const explicit = toArray(header).map(value => value.trim()).filter(Boolean).join('; ')

  const explicitNames = new Set(
    explicit.split(';').map((pair) => {
      const separatorIndex = pair.indexOf('=')
      return separatorIndex === -1 ? '' : pair.slice(0, separatorIndex).trim()
    }),
  )

  const pairs = cookies
    .filter(cookie => !explicit || !explicitNames.has(cookie.name))
    .map(cookie => cookie.name ? `${cookie.name}=${cookie.value}` : cookie.value)

  if (!pairs.length) {
    return undefined
  }

  return [explicit, ...pairs].filter(Boolean).join('; ')
}
