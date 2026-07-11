import type { Interceptor, Promisable, Value } from '@orpc/shared'
import type { StandardLazyResponse, StandardRequest } from '@standardserver/core'
import type { ToFetchBodyOptions } from '@standardserver/fetch'
import type { ClientContext, ClientOptions } from '../../types'
import type { StandardLinkTransport } from '../standard'
import type { FetchLinkTransportPlugin } from './plugin'
import { intercept, once, value } from '@orpc/shared'
import { toFetchBody, toFetchHeaders, toStandardLazyResponse } from '@standardserver/fetch'
import { CompositeFetchLinkTransportPlugin } from './plugin'

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

export interface FetchLinkTransportFetchInterceptorOptions<T extends ClientContext> extends ClientOptions<T> {
  path: string[]
  url: string
  init: RequestInit
}
export type FetchLinkTransportFetchInterceptor<T extends ClientContext> = Interceptor<FetchLinkTransportFetchInterceptorOptions<T>, Promise<Response>>

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
   * @default globalThis.fetch.bind(globalThis)
   */
  fetch?(url: string, init: RequestInit, options: ClientOptions<T>, path: string[]): Promise<Response>

  /**
   * Interceptors that execute before the actual fetch call, useful for modifying the fetch parameters, adding logging, etc.
   */
  fetchInterceptors?: FetchLinkTransportFetchInterceptor<T>[]

  plugins?: FetchLinkTransportPlugin<T>[]
}

export class FetchLinkTransport<T extends ClientContext> implements StandardLinkTransport<T> {
  private readonly origin: FetchLinkTransportOptions<T>['origin']
  private readonly fetch: Exclude<FetchLinkTransportOptions<T>['fetch'], undefined>
  private readonly toFetchRequestOptions: FetchLinkTransportOptions<T>['toFetchRequest']
  private readonly fetchInterceptors: FetchLinkTransportOptions<T>['fetchInterceptors']

  constructor(options: FetchLinkTransportOptions<T>) {
    options = new CompositeFetchLinkTransportPlugin(options.plugins).initFetchLinkTransportOptions(options)

    this.origin = options.origin
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.toFetchRequestOptions = options.toFetchRequest
    this.fetchInterceptors = options.fetchInterceptors
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

    const response = await intercept(
      this.fetchInterceptors,
      { ...options, url, path, init },
      ({ url, path, init, ...options }) => this.fetch(url, init, options, path),
    )

    const standardResponse = toStandardLazyResponse(response)

    return standardResponse
  }
}
