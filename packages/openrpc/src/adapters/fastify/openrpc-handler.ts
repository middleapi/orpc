import type { Context, Router } from '@orpc/server'
import type { FastifyHandlerOptions } from '@orpc/server/fastify'
import type { StandardOpenRPCHandlerOptions } from '../standard'
import { FastifyHandler } from '@orpc/server/fastify'
import { StandardOpenRPCHandler } from '../standard'

export interface OpenRPCHandlerOptions<T extends Context> extends FastifyHandlerOptions<T>, StandardOpenRPCHandlerOptions<T> {}

/**
 * Serves oRPC procedures as a JSON-RPC 2.0 API over HTTP POST using Fastify.
 *
 * @see {@link https://orpc.dev/docs/openrpc/handler | OpenRPC Handler}
 */
export class OpenRPCHandler<T extends Context> extends FastifyHandler<T> {
  constructor(router: Router<T>, options: NoInfer<OpenRPCHandlerOptions<T>> = {}) {
    super(new StandardOpenRPCHandler(router, options), options)
  }
}
