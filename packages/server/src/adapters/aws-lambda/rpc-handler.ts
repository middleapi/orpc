import type { Context } from '../../context.ts'
import type { Router } from '../../router.ts'
import type { RPCHandlerCodecOptions, StandardHandlerOptions } from '../standard/index.ts'
import { RPCHandlerCodec, StandardHandler } from '../standard/index.ts'
import type { AwsLambdaHandlerOptions } from './handler.ts'
import { AwsLambdaHandler } from './handler.ts'

export interface RPCHandlerOptions<T extends Context>
  extends AwsLambdaHandlerOptions<T>, StandardHandlerOptions<T>, RPCHandlerCodecOptions<T> {}

/**
 * Serves an oRPC router over the RPC protocol on AWS Lambda,
 * behind API Gateway or Lambda Function URLs.
 *
 * @remarks
 * **Warning**: Requires the Lambda Node.js runtime with response streaming enabled, so handlers must be wrapped with `awslambda.streamifyResponse`.
 *
 * @see {@link https://orpc.dev/docs/adapters/aws-lambda | AWS Lambda Adapter}
 */
export class RPCHandler<T extends Context> extends AwsLambdaHandler<T> {
  constructor(router: Router<T>, options: NoInfer<RPCHandlerOptions<T>> = {}) {
    const codec = new RPCHandlerCodec(router, options)
    const handler = new StandardHandler(codec, options)
    super(handler, options)
  }
}
