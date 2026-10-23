import type { Context, Router } from '@orpc/server'
import type { FastifyHandlerOptions } from '@orpc/server/fastify'
import type { StandardHandlerOptions } from '@orpc/server/standard'
import type { OpenRPCEnvelopeHandlerPluginOptions, OpenRPCHandlerCodecOptions } from '../standard'
import { FastifyHandler } from '@orpc/server/fastify'
import { StandardHandler } from '@orpc/server/standard'
import { toArray } from '@orpc/shared'
import { OpenRPCEnvelopeHandlerPlugin, OpenRPCHandlerCodec } from '../standard'

export interface OpenRPCHandlerOptions<T extends Context>
  extends FastifyHandlerOptions<T>, StandardHandlerOptions<T>, OpenRPCHandlerCodecOptions<T>, OpenRPCEnvelopeHandlerPluginOptions<T> {}

/**
 * Serves oRPC procedures as a JSON-RPC 2.0 API over HTTP POST using Fastify.
 *
 * @see {@link https://orpc.dev/docs/openrpc/handler | OpenRPC Handler}
 */
export class OpenRPCHandler<T extends Context> extends FastifyHandler<T> {
  constructor(router: Router<T>, options: NoInfer<OpenRPCHandlerOptions<T>> = {}) {
    const codec = new OpenRPCHandlerCodec(router, options)
    const plugins = [...toArray(options.plugins), new OpenRPCEnvelopeHandlerPlugin(options)]
    super(new StandardHandler(codec, { ...options, plugins }), options)
  }
}
