import type { Context, Router } from '@orpc/server'
import type { FetchHandlerOptions } from '@orpc/server/fetch'
import type { StandardOpenRPCHandlerOptions } from '../standard'
import { FetchHandler } from '@orpc/server/fetch'
import { StandardOpenRPCHandler } from '../standard'

export interface OpenRPCHandlerOptions<T extends Context> extends FetchHandlerOptions<T>, StandardOpenRPCHandlerOptions<T> {}

/**
 * Serves oRPC procedures as a JSON-RPC 2.0 API over HTTP POST using Fetch API `Request`/`Response`.
 *
 * @see {@link https://orpc.dev/docs/openrpc/handler | OpenRPC Handler}
 */
export class OpenRPCHandler<T extends Context> extends FetchHandler<T> {
  constructor(router: Router<T>, options: NoInfer<OpenRPCHandlerOptions<T>> = {}) {
    super(new StandardOpenRPCHandler(router, options), options)
  }
}
