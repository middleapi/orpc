import type { MaybeOptionalOptions } from '@orpc/shared'
import type { AnyFastifyReply, AnyFastifyRequest, SendStandardResponseOptions } from '@standard-server/fastify'
import type { Context } from '../../context'
import type { FriendlyStandardHandlerHandleOptions, StandardHandler } from '../standard'
import { resolveMaybeOptionalOptions } from '@orpc/shared'
import { sendStandardResponse, toStandardLazyRequest } from '@standard-server/fastify'
import { canWriteToNodeResponse } from '@standard-server/node'
import { resolveFriendlyStandardHandlerHandleOptions } from '../standard'

export type FastifyHandlerHandleResult = { matched: true } | { matched: false }

export interface FastifyHandlerOptions<_T extends Context> {
  /**
   * Custom options for `sendStandardResponse`, used to send a `Standard Response`
   */
  sendStandardResponse?: SendStandardResponseOptions | undefined

  /**
   * Called when sending the response fails, including client resets that surface as errors
   * (e.g. HTTP/2 `ERR_HTTP2_STREAM_ERROR`). `handle()` resolves either way.
   */
  onSendResponseError?: undefined | ((error: unknown) => void)
}

export class FastifyHandler<T extends Context> {
  private readonly sendStandardResponseOptions: FastifyHandlerOptions<T>['sendStandardResponse']
  private readonly onSendResponseError: FastifyHandlerOptions<T>['onSendResponseError']

  constructor(
    private readonly standardHandler: StandardHandler<T>,
    options: NoInfer<FastifyHandlerOptions<T>> = {},
  ) {
    this.sendStandardResponseOptions = options.sendStandardResponse
    this.onSendResponseError = options.onSendResponseError
  }

  /**
   * Does not reject when sending the response fails or the client resets the stream:
   * an empty `500` is sent if nothing was written yet, otherwise the failure is only reported to `onSendResponseError`.
   */
  async handle(
    request: AnyFastifyRequest,
    reply: AnyFastifyReply,
    ...rest: MaybeOptionalOptions<FriendlyStandardHandlerHandleOptions<T>>
  ): Promise<FastifyHandlerHandleResult> {
    const standardRequest = toStandardLazyRequest(request, reply)

    const result = await this.standardHandler.handle(
      standardRequest,
      resolveFriendlyStandardHandlerHandleOptions(resolveMaybeOptionalOptions(rest)),
    )

    if (!result.matched) {
      return result
    }

    try {
      await sendStandardResponse(reply, result.response, this.sendStandardResponseOptions)
    }
    catch (error) {
      this.onSendResponseError?.(error)

      /**
       * Still writable means nothing was sent (body conversion failed before writing), so a bare 500 can be sent.
       * Otherwise the peer reset/aborted the stream, or a write failed mid-response: nothing more can be sent.
       */
      if (canWriteToNodeResponse(reply.raw)) {
        await sendStandardResponse(reply, { status: 500, headers: {}, body: undefined }).catch(() => {})
      }
    }

    return result
  }
}
