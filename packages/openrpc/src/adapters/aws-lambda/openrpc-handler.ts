import type { Context, Router } from '@orpc/server'
import type { AwsLambdaHandlerOptions } from '@orpc/server/aws-lambda'
import type { StandardHandlerOptions } from '@orpc/server/standard'
import type { OpenRPCEnvelopeHandlerPluginOptions, OpenRPCHandlerCodecOptions } from '../standard'
import { AwsLambdaHandler } from '@orpc/server/aws-lambda'
import { StandardHandler } from '@orpc/server/standard'
import { toArray } from '@orpc/shared'
import { OpenRPCEnvelopeHandlerPlugin, OpenRPCHandlerCodec } from '../standard'

export interface OpenRPCHandlerOptions<T extends Context>
  extends AwsLambdaHandlerOptions<T>, StandardHandlerOptions<T>, OpenRPCHandlerCodecOptions<T>, OpenRPCEnvelopeHandlerPluginOptions<T> {}

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
    const codec = new OpenRPCHandlerCodec(router, options)
    const plugins = [...toArray(options.plugins), new OpenRPCEnvelopeHandlerPlugin(options)]
    super(new StandardHandler(codec, { ...options, plugins }), options)
  }
}
