import type { Context, Router } from '@orpc/server'
import type { NodeHttpHandlerOptions } from '@orpc/server/node'
import type { StandardOpenRPCHandlerOptions } from '../standard'
import { NodeHttpHandler } from '@orpc/server/node'
import { StandardOpenRPCHandler } from '../standard'

export interface OpenRPCHandlerOptions<T extends Context> extends NodeHttpHandlerOptions<T>, StandardOpenRPCHandlerOptions<T> {}

/**
 * Serves oRPC procedures as a JSON-RPC 2.0 API over HTTP POST using Node.js built-in HTTP request/response.
 *
 * @see {@link https://orpc.dev/docs/openrpc/handler | OpenRPC Handler}
 */
export class OpenRPCHandler<T extends Context> extends NodeHttpHandler<T> {
  constructor(router: Router<T>, options: NoInfer<OpenRPCHandlerOptions<T>> = {}) {
    super(new StandardOpenRPCHandler(router, options), options)
  }
}
