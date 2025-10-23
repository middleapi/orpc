import type { Interceptor, MaybeOptionalOptions } from '@orpc/shared'
import type { FastifyReply, FastifyRequest, SendStandardResponseOptions } from '@orpc/standard-server-fastify'
import type { Context } from '../../context'
import type { StandardHandleOptions, StandardHandler } from '../standard'
import type { FriendlyStandardHandleOptions } from '../standard/utils'
import { intercept, resolveMaybeOptionalOptions, toArray } from '@orpc/shared'
import { sendStandardResponse, toStandardLazyRequest } from '@orpc/standard-server-fastify'
import { resolveFriendlyStandardHandleOptions } from '../standard/utils'

export type FastifyHandleResult = { matched: true } | { matched: false }

export interface FastifyInterceptorOptions<T extends Context> extends StandardHandleOptions<T> {
  request: FastifyRequest
  reply: FastifyReply
  sendStandardResponseOptions: SendStandardResponseOptions
}

export interface FastifyHandlerOptions<T extends Context> extends SendStandardResponseOptions {
  adapterInterceptors?: Interceptor<FastifyInterceptorOptions<T>, Promise<FastifyHandleResult>>[]
}

export class FastifyHandler<T extends Context> {
  private readonly sendStandardResponseOptions: SendStandardResponseOptions
  private readonly adapterInterceptors: Exclude<FastifyHandlerOptions<T>['adapterInterceptors'], undefined>

  constructor(
    private readonly standardHandler: StandardHandler<T>,
    options: NoInfer<FastifyHandlerOptions<T>> = {},
  ) {
    this.adapterInterceptors = toArray(options.adapterInterceptors)
    this.sendStandardResponseOptions = options
  }

  async handle(
    request: FastifyRequest,
    reply: FastifyReply,
    ...rest: MaybeOptionalOptions<FriendlyStandardHandleOptions<T>>
  ): Promise<FastifyHandleResult> {
    return intercept(
      this.adapterInterceptors,
      {
        ...resolveFriendlyStandardHandleOptions(resolveMaybeOptionalOptions(rest)),
        request,
        reply,
        sendStandardResponseOptions: this.sendStandardResponseOptions,
      },
      async ({ request, reply, sendStandardResponseOptions, ...options }) => {
        const standardRequest = toStandardLazyRequest(request, reply)

        const result = await this.standardHandler.handle(standardRequest, options)

        if (!result.matched) {
          return { matched: false }
        }

        await sendStandardResponse(reply, result.response, sendStandardResponseOptions)

        return { matched: true }
      },
    )
  }
}
