import type { Promisable, Value } from '@orpc/shared'
import type { StandardLazyResponse, StandardRequest } from '@standard-server/core'
import type { ToFetchBodyOptions } from '@standard-server/fetch'
import type { ClientContext, ClientOptions } from '../../types'
import type { StandardLinkTransport } from '../standard'
import { once, value } from '@orpc/shared'
import { toFetchBody, toFetchHeaders, toStandardHeaders, toStandardLazyResponse } from '@standard-server/fetch'
import { createORPCErrorFromMalformedResponse } from '../../error-utils'

const GET_SUPPORTED_DUPLEX_MODE = once(() => {
  // TODO: Try `duplex: 'full'` when it is widely supported.
  try {
    let duplex: 'half' | undefined

    void new Request(
      'https://example.com',
      {
        method: 'POST',
        body: new ReadableStream(),
        get duplex() {
          duplex = 'half'
          return 'half'
        },
      } as any,
    )

    return duplex
  }
  catch {
    return undefined
  }
})

export interface FetchLinkTransportOptions<T extends ClientContext> {
  /**
   * The origin to prepend to all request URLs, useful for CORS requests.
   *
   * @example 'https://api.example.com'
   * @example 'http://localhost:3000'
   */
  origin?: Value<Promisable<`https://${string}` | `http://${string}` | ({} & string) | undefined>, [options: ClientOptions<T>, path: string[]]>

  /**
   * Options for how to convert the Standard Request to a Fetch Request, like event stream options, etc.
   */
  toFetchRequest?: undefined | ToFetchBodyOptions

  /**
   * Override the default fetch implementation.
   *
   * @default (url, init) => globalThis.fetch(url, init)
   */
  fetch?(url: string, init: RequestInit, options: ClientOptions<T>, path: string[]): Promise<Response>
}

export class FetchLinkTransport<T extends ClientContext> implements StandardLinkTransport<T> {
  private readonly origin: FetchLinkTransportOptions<T>['origin']
  private readonly fetch: Exclude<FetchLinkTransportOptions<T>['fetch'], undefined>
  private readonly toFetchRequestOptions: FetchLinkTransportOptions<T>['toFetchRequest']

  constructor(options: FetchLinkTransportOptions<T>) {
    this.origin = options.origin
    // Resolve `globalThis.fetch` lazily so interception tools (msw, undici MockAgent, etc.)
    // that patch it after this transport is constructed still take effect.
    this.fetch = options.fetch ?? ((url, init) => (globalThis.fetch)(url, init))
    this.toFetchRequestOptions = options.toFetchRequest
  }

  async send(standardRequest: StandardRequest, path: string[], options: ClientOptions<T>): Promise<StandardLazyResponse> {
    let origin = await value(this.origin, options, path)
    if (origin?.endsWith('/')) {
      origin = origin.slice(0, -1)
    }

    const url = `${origin ?? ''}${standardRequest.url}`
    const [body, standardHeaders] = toFetchBody(standardRequest.body, standardRequest.headers, this.toFetchRequestOptions)

    const init: RequestInit & { duplex?: ReturnType<typeof GET_SUPPORTED_DUPLEX_MODE> } = {
      body,
      headers: toFetchHeaders(standardHeaders),
      method: standardRequest.method,
      signal: options.signal,
      redirect: 'manual',
    }

    if (body instanceof ReadableStream) {
      const duplex = GET_SUPPORTED_DUPLEX_MODE()
      if (duplex !== undefined) {
        init.duplex = duplex
      }
    }

    // Call without a receiver: browsers throw "Illegal invocation" when native `fetch` is called on a non-global `this`.
    const fetch = this.fetch
    const response = await fetch(url, init, options, path)

    /**
     * With `redirect: 'manual'`, browsers turn a redirect into an opaque-redirect response
     * that hides the real status, headers, and body. Reject it instead of decoding it as a success.
     */
    if (response.status === 0 || response.type === 'opaqueredirect') {
      throw createORPCErrorFromMalformedResponse({
        message: `Received an opaque response (status ${response.status}, type "${response.type}"), likely from a redirect. Redirects are not followed, and browsers hide the status, headers, and body of redirect responses.`,
        response: { status: response.status, headers: toStandardHeaders(response.headers), body: undefined },
      })
    }

    const standardResponse = toStandardLazyResponse(response)

    return standardResponse
  }
}
