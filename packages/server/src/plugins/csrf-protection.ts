import type { Promisable } from '@orpc/shared'
import type { StandardHandlerInterceptor, StandardHandlerInterceptorOptions, StandardHandlerOptions, StandardHandlerPlugin } from '../adapters/standard'
import type { Context } from '../context'
import { ORPCError } from '@orpc/client'
import { toArray, tryOrUndefined } from '@orpc/shared'
import { flattenStandardHeader } from '@standard-server/core'

export interface CsrfProtectionHandlerPluginOptions<T extends Context> {
  /**
   * Origins allowed to send cross-site requests, such as a frontend on another site calling
   * the API with credentials. An array is matched exactly against the `Origin` header, in its
   * `scheme://host[:port]` form, such as `https://app.example.com`. A function (optionally
   * async) receives the `Origin` header and the interceptor options and decides per request.
   *
   * @default []
   */
  trustedOrigins?: readonly string[] | ((origin: string, options: StandardHandlerInterceptorOptions<T>) => Promisable<boolean>)
}

/**
 * Adds Cross-Site Request Forgery (CSRF) protection for unsafe methods such as `POST`, `PUT`,
 * `PATCH`, and `DELETE`, modeled on Go's `http.CrossOriginProtection`. It rejects requests that
 * browsers report as cross-site, including HTML form submissions and `no-cors` fetches, which
 * reach procedures without a CORS preflight and carry any cookie not marked `SameSite=Lax` or
 * `SameSite=Strict`. Requests matching no procedure stay unmatched.
 *
 * @remarks
 * **Note**: Unlike Go, same-site requests, such as those from a sibling subdomain, pass,
 * matching the `SameSite` cookie model where the site is the trust boundary. Safe methods
 * (`GET`, `HEAD`, `OPTIONS`) always pass, so pair it with `GetMethodCsrfProtectionHandlerPlugin`
 * when `GET` is enabled. Legitimate cross-site clients, such as a frontend on another site,
 * must be listed in `trustedOrigins`.
 *
 * @see {@link https://orpc.dev/docs/plugins/csrf-protection | CSRF Protection Plugin}
 */
export class CsrfProtectionHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~csrf-protection'

  private readonly trustedOrigins: Exclude<CsrfProtectionHandlerPluginOptions<T>['trustedOrigins'], undefined>

  constructor(options: CsrfProtectionHandlerPluginOptions<T> = {}) {
    this.trustedOrigins = options.trustedOrigins ?? []
  }

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    /**
     * Batch sub-requests are judged individually here, which is safe: the batch plugin's
     * default `mapSubrequest` keeps the transport headers authoritative over client-authored
     * sub-request headers, so `sec-fetch-site`, `origin`, and `host` are the ones the browser sent.
     */
    const interceptor: StandardHandlerInterceptor<T> = async (interceptorOptions) => {
      if (await this.isAllowed(interceptorOptions)) {
        return interceptorOptions.next()
      }

      throw new ORPCError('FORBIDDEN', { message: 'Request blocked by CSRF protection.' })
    }

    return {
      ...options,
      interceptors: [interceptor, ...toArray(options.interceptors)],
    }
  }

  private async isAllowed(options: StandardHandlerInterceptorOptions<T>): Promise<boolean> {
    const { request } = options

    // Safe methods are left alone, and `GET` is the `GetMethodCsrfProtectionHandlerPlugin`'s job.
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
      return true
    }

    const site = flattenStandardHeader(request.headers['sec-fetch-site'])?.toLowerCase()

    // `none` marks requests no site initiated, such as those from a browser extension.
    // Same-site origins are trusted, matching the `SameSite` cookie model where the site is
    // the trust boundary.
    if (site === 'same-origin' || site === 'same-site' || site === 'none') {
      return true
    }

    const origin = flattenStandardHeader(request.headers.origin)

    // Fetch Metadata is absent for non-browser clients, browsers too old to send it, and any
    // browser over plain HTTP. Browsers still send `Origin` on unsafe methods, so fall back to
    // comparing it with `Host`. Without either, the request did not come from a browser.
    if (site === undefined) {
      if (origin === undefined) {
        return true
      }

      // `:authority` replaces `Host` on HTTP/2 requests from the Node adapter.
      const host = flattenStandardHeader(request.headers.host ?? request.headers[':authority'])?.toLowerCase()
      const originHost = tryOrUndefined(() => new URL(origin).host)

      if (host !== undefined && originHost === host) {
        return true
      }
    }

    // Cross-site, or any value this plugin does not recognize. Browsers send `Origin` on every
    // unsafe-method request, so a stripped one blocks the request rather than bypassing the check.
    if (origin === undefined) {
      return false
    }

    if (typeof this.trustedOrigins === 'function') {
      return this.trustedOrigins(origin, options)
    }

    return this.trustedOrigins.includes(origin)
  }
}
