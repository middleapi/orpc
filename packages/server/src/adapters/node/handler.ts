import type { MaybeOptionalOptions } from '@orpc/shared'
import type { NodeHttpRequest, NodeHttpResponse, SendStandardResponseOptions } from '@standard-server/node'
import type { Context } from '../../context'
import type { FriendlyStandardHandlerHandleOptions, StandardHandler } from '../standard'
import { resolveMaybeOptionalOptions } from '@orpc/shared'
import { canWriteToNodeResponse, sendStandardResponse, toStandardLazyRequest } from '@standard-server/node'
import { resolveFriendlyStandardHandlerHandleOptions } from '../standard'

export type NodeHttpHandlerHandleResult = { matched: true } | { matched: false }

export interface NodeHttpHandlerOptions<_T extends Context> {
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

export class NodeHttpHandler<T extends Context> {
  private readonly sendStandardResponseOptions: NodeHttpHandlerOptions<T>['sendStandardResponse']
  private readonly onSendResponseError: NodeHttpHandlerOptions<T>['onSendResponseError']

  constructor(
    private readonly standardHandler: StandardHandler<T>,
    options: NoInfer<NodeHttpHandlerOptions<T>> = {},
  ) {
    this.sendStandardResponseOptions = options.sendStandardResponse
    this.onSendResponseError = options.onSendResponseError
  }

  /**
   * Does not reject when sending the response fails or the client resets the stream:
   * an empty `500` is sent if nothing was written yet, otherwise the failure is only reported to `onSendResponseError`.
   */
  async handle(
    request: NodeHttpRequest,
    response: NodeHttpResponse,
    ...rest: MaybeOptionalOptions<FriendlyStandardHandlerHandleOptions<T>>
  ): Promise<NodeHttpHandlerHandleResult> {
    const standardRequest = toStandardLazyRequest(request, response)

    const result = await this.standardHandler.handle(
      standardRequest,
      resolveFriendlyStandardHandlerHandleOptions(resolveMaybeOptionalOptions(rest)),
    )

    if (!result.matched) {
      return result
    }

    try {
      await sendStandardResponse(response, result.response, this.sendStandardResponseOptions)
    }
    catch (error) {
      this.onSendResponseError?.(error)

      /**
       * Still writable means nothing was sent (body conversion failed before writing), so a bare 500 can be sent.
       * Otherwise the peer reset/aborted the stream, or a write failed mid-response: nothing more can be sent.
       */
      if (canWriteToNodeResponse(response)) {
        await sendStandardResponse(response, { status: 500, headers: {}, body: undefined }).catch(() => {})
      }
    }

    return result
  }
}
