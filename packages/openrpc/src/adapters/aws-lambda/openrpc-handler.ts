import type { Context, Router } from '@orpc/server'
import type { AwsLambdaHandlerOptions } from '@orpc/server/aws-lambda'
import type { StandardOpenRPCHandlerOptions } from '../standard'
import { AwsLambdaHandler } from '@orpc/server/aws-lambda'
import { StandardOpenRPCHandler } from '../standard'

export interface OpenRPCHandlerOptions<T extends Context> extends AwsLambdaHandlerOptions<T>, StandardOpenRPCHandlerOptions<T> {}

/**
 * Serves oRPC procedures as a JSON-RPC 2.0 API over HTTP POST using AWS Lambda.
 *
 * @remarks
 * **Warning**: Requires the AWS Lambda Node.js runtime with response streaming enabled — handlers should be wrapped with `awslambda.streamifyResponse`.
 *
 * @see {@link https://orpc.dev/docs/openrpc/handler | OpenRPC Handler}
 */
export class OpenRPCHandler<T extends Context> extends AwsLambdaHandler<T> {
  constructor(router: Router<T>, options: NoInfer<OpenRPCHandlerOptions<T>> = {}) {
    super(new StandardOpenRPCHandler(router, options), options)
  }
}
