import type { MaybeOptionalOptions } from '@orpc/shared'
import type { AnyAPIGatewayProxyEvent, HttpResponseStream, SendStandardResponseOptions } from '@standard-server/aws-lambda'
import type { Context } from '../../context'
import type { FriendlyStandardHandlerHandleOptions, StandardHandler } from '../standard'
import { resolveMaybeOptionalOptions } from '@orpc/shared'
import { sendStandardResponse, toStandardLazyRequest } from '@standard-server/aws-lambda'
import { canWriteToNodeResponse } from '@standard-server/node'
import { resolveFriendlyStandardHandlerHandleOptions } from '../standard'

export type AwsLambdaHandlerHandleResult = { matched: true } | { matched: false }

export interface AwsLambdaHandlerOptions<_T extends Context> {
  /**
   * Custom options for `sendStandardResponse`, used to send a `Standard Response`
   */
  sendStandardResponse?: SendStandardResponseOptions | undefined

  /**
   * Called when sending the response fails (e.g. the response stream errored).
   */
  onSendResponseError?: undefined | ((error: unknown) => void)
}

/**
 * Requires the AWS Lambda Node.js runtime with response streaming enabled,
 * handlers should be wrapped with `awslambda.streamifyResponse`.
 */
export class AwsLambdaHandler<T extends Context> {
  private readonly sendStandardResponseOptions: AwsLambdaHandlerOptions<T>['sendStandardResponse']
  private readonly onSendResponseError: AwsLambdaHandlerOptions<T>['onSendResponseError']

  constructor(
    private readonly standardHandler: StandardHandler<T>,
    options: NoInfer<AwsLambdaHandlerOptions<T>> = {},
  ) {
    this.sendStandardResponseOptions = options.sendStandardResponse
    this.onSendResponseError = options.onSendResponseError
  }

  /**
   * Does not reject when sending the response fails or the response stream is destroyed:
   * an empty `500` is sent if nothing was written yet, otherwise the failure is only reported to `onSendResponseError`.
   */
  async handle(
    event: AnyAPIGatewayProxyEvent,
    responseStream: HttpResponseStream,
    ...rest: MaybeOptionalOptions<FriendlyStandardHandlerHandleOptions<T>>
  ): Promise<AwsLambdaHandlerHandleResult> {
    const standardRequest = toStandardLazyRequest(event, responseStream)

    const result = await this.standardHandler.handle(
      standardRequest,
      resolveFriendlyStandardHandlerHandleOptions(resolveMaybeOptionalOptions(rest)),
    )

    if (!result.matched) {
      return result
    }

    try {
      await sendStandardResponse(responseStream, result.response, this.sendStandardResponseOptions)
    }
    catch (error) {
      this.onSendResponseError?.(error)

      /**
       * Still writable means nothing was sent (body conversion failed before writing), so a bare 500 can be sent.
       * Otherwise the stream was destroyed, or a write failed mid-response: nothing more can be sent.
       */
      if (canWriteToNodeResponse(responseStream)) {
        await sendStandardResponse(responseStream, { status: 500, headers: {}, body: undefined }).catch(() => {})
      }
    }

    return result
  }
}
