import type { Value } from '@orpc/shared'
import type { StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor, StandardHandlerRoutingInterceptorOptions } from '../adapters/standard'
import type { Context } from '../context'
import { toArray, value } from '@orpc/shared'
import { flattenStandardHeader } from '@standardserver/core'

export interface SimpleCsrfProtectionHandlerPluginOptions<T extends Context> {
  /**
   * Cross-site and same-site origins trusted to invoke procedures, as a string, an array, or a
   * function returning them. Each entry must be a specific origin. Consulted only for requests
   * your own origin did not initiate and that carry an `Origin` header, so it usually matches
   * the allowlist you pass to the CORS Handler Plugin.
   *
   * @default undefined (no other origin is trusted)
   */
  origin?: Value<string | readonly string[] | null | undefined, [origin: string, options: StandardHandlerRoutingInterceptorOptions<T>]>

  /**
   * Trust every origin on the same site, such as a sibling subdomain. Off by default, since a
   * subdomain you do not control can forge requests carrying your cookies. Prefer `origin`.
   *
   * @default false
   */
  allowSameSite?: boolean

  /**
   * [Sec-Fetch-Mode](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Mode)
   * values allowed to invoke a procedure. Narrow it to `['cors', 'same-origin']` to accept
   * scripted requests only, which rejects HTML form submissions. Requests carrying no
   * `Sec-Fetch-Mode` header are never rejected by this option.
   *
   * @default undefined (every mode is allowed)
   */
  allowModes?: readonly ('cors' | 'navigate' | 'no-cors' | 'same-origin' | 'websocket' | (string & {}))[]
}

/**
 * Adds basic Cross-Site Request Forgery (CSRF) protection by rejecting requests a browser
 * reports as initiated by another site, or by no page at all such as a link from an email.
 *
 * @remarks
 * **Note**: Unlike `SameSite` cookies, this also covers cross-site requests that still carry
 * cookies, so it is the safeguard to add when enabling the `GET` method on RPC handlers.
 *
 * @see {@link https://orpc.dev/docs/plugins/simple-csrf-protection | Simple CSRF Protection Plugin}
 */
export class SimpleCsrfProtectionHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~simple-csrf-protection'

  /** Judge the real request, before batch splits it into client-authored sub-requests. */
  after = ['~batch']

  private readonly origin: SimpleCsrfProtectionHandlerPluginOptions<T>['origin']
  private readonly allowSameSite: boolean
  private readonly allowModes: ReadonlySet<string> | undefined

  constructor(options: SimpleCsrfProtectionHandlerPluginOptions<T> = {}) {
    this.origin = options.origin
    this.allowSameSite = options.allowSameSite ?? false
    this.allowModes = options.allowModes === undefined
      ? undefined
      : new Set(options.allowModes.map(mode => mode.toLowerCase()))
  }

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const routingInterceptor: StandardHandlerRoutingInterceptor<T> = (interceptorOptions) => {
      if (this.isAllowed(interceptorOptions)) {
        return interceptorOptions.next()
      }

      return Promise.resolve({
        matched: true,
        response: { status: 403, headers: {}, body: 'Request blocked by CSRF protection.' },
      })
    }

    return {
      ...options,
      routingInterceptors: [routingInterceptor, ...toArray(options.routingInterceptors)],
    }
  }

  private isAllowed(interceptorOptions: StandardHandlerRoutingInterceptorOptions<T>): boolean {
    const headers = interceptorOptions.request.headers

    if (this.allowModes !== undefined) {
      const mode = flattenStandardHeader(headers['sec-fetch-mode'])?.toLowerCase()

      // A missing header carries no signal; the site check below still covers those requests.
      if (mode !== undefined && !this.allowModes.has(mode)) {
        return false
      }
    }

    const site = flattenStandardHeader(headers['sec-fetch-site'])?.toLowerCase()

    // Absent for non-browser clients, browsers too old to send Fetch Metadata, and any browser
    // over plain HTTP, where the headers are never appended. Nothing to judge in those cases.
    if (site === undefined || site === 'same-origin' || (site === 'same-site' && this.allowSameSite)) {
      return true
    }

    // Your own origin did not initiate this. A cross-site `fetch` reaches the server even when
    // CORS hides the response, so it runs unless the origin is explicitly trusted. Links,
    // GET navigations and passive loads such as `<img>` send no `Origin` at all, so no
    // allowlist can match them.
    const origin = flattenStandardHeader(headers.origin)

    if (origin === undefined) {
      return false
    }

    return toArray(value(this.origin, origin, interceptorOptions)).includes(origin)
  }
}
