import type { Interceptor, MaybeOptionalOptions } from '@orpc/shared'
import type { NodeHttpRequest, NodeHttpResponse, SendStandardResponseOptions } from '@orpc/standard-server-node'
import type { Context } from '../../context'
import type { StandardHandleOptions, StandardHandler } from '../standard'
import type { FriendlyStandardHandleOptions } from '../standard/utils'
import type { NodeHttpHandlerPlugin } from './plugin'
import { intercept, resolveMaybeOptionalOptions, toArray } from '@orpc/shared'
import { sendStandardResponse, toStandardLazyRequest } from '@orpc/standard-server-node'
import { resolveFriendlyStandardHandleOptions } from '../standard/utils'
import { CompositeNodeHttpHandlerPlugin } from './plugin'

export type NodeHttpHandleResult = { matched: true } | { matched: false }

export interface NodeHttpHandlerInterceptorOptions<T extends Context> extends StandardHandleOptions<T> {
  request: NodeHttpRequest
  response: NodeHttpResponse
  sendStandardResponseOptions: SendStandardResponseOptions
}

export interface NodeHttpHandlerOptions<T extends Context> extends SendStandardResponseOptions {
  adapterInterceptors?: Interceptor<NodeHttpHandlerInterceptorOptions<T>, Promise<NodeHttpHandleResult>>[]

  plugins?: NodeHttpHandlerPlugin<T>[]
}

export class NodeHttpHandler<T extends Context> {
  private readonly sendStandardResponseOptions: SendStandardResponseOptions
  private readonly adapterInterceptors: Exclude<NodeHttpHandlerOptions<T>['adapterInterceptors'], undefined>

  constructor(
    private readonly standardHandler: StandardHandler<T>,
    options: NoInfer<NodeHttpHandlerOptions<T>> = {},
  ) {
    const plugin = new CompositeNodeHttpHandlerPlugin(options.plugins)

    plugin.initRuntimeAdapter(options)

    this.adapterInterceptors = toArray(options.adapterInterceptors)
    this.sendStandardResponseOptions = options
  }

  async handle(
    request: NodeHttpRequest,
    response: NodeHttpResponse,
    ...rest: MaybeOptionalOptions<FriendlyStandardHandleOptions<T>>
  ): Promise<NodeHttpHandleResult> {
    return intercept(
      this.adapterInterceptors,
      {
        ...resolveFriendlyStandardHandleOptions(resolveMaybeOptionalOptions(rest)),
        request,
        response,
        sendStandardResponseOptions: this.sendStandardResponseOptions,
      },
      async ({ request, response, sendStandardResponseOptions, ...options }) => {
        const standardRequest = toStandardLazyRequest(request, response)

        const result = await this.standardHandler.handle(standardRequest, options)

        if (!result.matched) {
          return { matched: false }
        }

        await sendStandardResponse(response, result.response, sendStandardResponseOptions)

        return { matched: true }
      },
    )
  }
}
