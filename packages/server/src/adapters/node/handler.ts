import type { Interceptor, MaybeOptionalOptions } from '@orpc/shared'
import type { NodeHttpRequest, NodeHttpResponse, SendStandardResponseOptions } from '@standardserver/node'
import type { Context } from '../../context'
import type { FriendlyStandardHandlerHandleOptions, StandardHandler, StandardHandlerHandleOptions } from '../standard'
import type { NodeHttpHandlerPlugin } from './plugin'
import { intercept, resolveMaybeOptionalOptions } from '@orpc/shared'
import { sendStandardResponse, toStandardLazyRequest } from '@standardserver/node'
import { resolveFriendlyStandardHandlerHandleOptions } from '../standard'
import { CompositeNodeHttpHandlerPlugin } from './plugin'

export type NodeHttpHandlerHandleResult = { matched: true } | { matched: false }

export interface NodeHttpHandlerNodeHttpInterceptorOptions<T extends Context> extends StandardHandlerHandleOptions<T> {
  request: NodeHttpRequest
  response: NodeHttpResponse
  sendStandardResponseOptions: SendStandardResponseOptions | undefined
}
export type NodeHttpHandlerNodeHttpInterceptor<T extends Context> = Interceptor<NodeHttpHandlerNodeHttpInterceptorOptions<T>, Promise<NodeHttpHandlerHandleResult>>

export interface NodeHttpHandlerOptions<T extends Context> {
  /**
   * Custom options for `sendStandardResponse`, used to send a `Standard Response`
   */
  sendStandardResponse?: SendStandardResponseOptions | undefined

  /**
   * Interceptors that run before the mapping between the Standard API and Node HTTP API,
   * useful for extending Node HTTP request/response before handling, ...
   */
  nodeHttpInterceptors?: NodeHttpHandlerNodeHttpInterceptor<T>[] | undefined

  plugins?: NodeHttpHandlerPlugin<T>[] | undefined
}

export class NodeHttpHandler<T extends Context> {
  private readonly sendStandardResponseOptions: NodeHttpHandlerOptions<T>['sendStandardResponse']
  private readonly nodeHttpInterceptors: NodeHttpHandlerOptions<T>['nodeHttpInterceptors']

  constructor(
    private readonly standardHandler: StandardHandler<T>,
    options: NoInfer<NodeHttpHandlerOptions<T>> = {},
  ) {
    options = new CompositeNodeHttpHandlerPlugin(options.plugins).initNodeHttpHandlerOptions(options)

    this.nodeHttpInterceptors = options.nodeHttpInterceptors
    this.sendStandardResponseOptions = options.sendStandardResponse
  }

  async handle(
    request: NodeHttpRequest,
    response: NodeHttpResponse,
    ...rest: MaybeOptionalOptions<FriendlyStandardHandlerHandleOptions<T>>
  ): Promise<NodeHttpHandlerHandleResult> {
    return intercept(
      this.nodeHttpInterceptors,
      {
        ...resolveFriendlyStandardHandlerHandleOptions(resolveMaybeOptionalOptions(rest)),
        request,
        response,
        sendStandardResponseOptions: this.sendStandardResponseOptions,
      },
      async ({ request, response, sendStandardResponseOptions, ...options }) => {
        const standardRequest = toStandardLazyRequest(request, response)

        const result = await this.standardHandler.handle(standardRequest, options)

        if (!result.matched) {
          return result
        }

        await sendStandardResponse(response, result.response, sendStandardResponseOptions)

        return result
      },
    )
  }
}
