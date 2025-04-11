import type { Interceptor, ThrowableError } from '@orpc/shared'
import type { StandardLazyResponse, StandardRequest } from '@orpc/standard-server'
import type { ClientContext, ClientLink, ClientOptions } from '../../types'
import type { StandardLinkPlugin } from './plugin'
import type { StandardLinkClient, StandardLinkCodec } from './types'
import { intercept, toArray } from '@orpc/shared'
import { CompositeStandardLinkPlugin } from './plugin'

export interface StandardLinkInterceptorOptions<T extends ClientContext> extends ClientOptions<T> {
  path: readonly string[]
  input: unknown
}

export interface StandardLinkClientInterceptorOptions<T extends ClientContext> extends StandardLinkInterceptorOptions<T> {
  request: StandardRequest
}

export interface StandardLinkOptions<T extends ClientContext> {
  interceptors?: Interceptor<StandardLinkInterceptorOptions<T>, unknown, ThrowableError>[]
  clientInterceptors?: Interceptor<StandardLinkClientInterceptorOptions<T>, StandardLazyResponse, ThrowableError>[]
  plugins?: StandardLinkPlugin<T>[]
}

export class StandardLink<T extends ClientContext> implements ClientLink<T> {
  private readonly interceptors: Exclude<StandardLinkOptions<T>['interceptors'], undefined>
  private readonly clientInterceptors: Exclude<StandardLinkOptions<T>['clientInterceptors'], undefined>

  constructor(
    public readonly codec: StandardLinkCodec<T>,
    public readonly sender: StandardLinkClient<T>,
    options: StandardLinkOptions<T> = {},
  ) {
    const plugin = new CompositeStandardLinkPlugin(options.plugins)

    plugin.init(options)

    this.interceptors = toArray(options.interceptors)
    this.clientInterceptors = toArray(options.clientInterceptors)
  }

  call(path: readonly string[], input: unknown, options: ClientOptions<T>): Promise<unknown> {
    return intercept(this.interceptors, { ...options, path, input }, async ({ path, input, ...options }) => {
      const output = await this.#call(path, input, options)

      return output
    })
  }

  async #call(path: readonly string[], input: unknown, options: ClientOptions<T>): Promise<unknown> {
    const request = await this.codec.encode(path, input, options)

    const response = await intercept(
      this.clientInterceptors,
      { ...options, input, path, request },
      ({ input, path, request, ...options }) => this.sender.call(request, options, path, input),
    )

    const output = await this.codec.decode(response, options, path, input)

    return output
  }
}
