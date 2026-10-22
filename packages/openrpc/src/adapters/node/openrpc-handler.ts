import type { Context, Router } from '@orpc/server'
import type { NodeHttpHandlerOptions } from '@orpc/server/node'
import type { StandardHandlerOptions } from '@orpc/server/standard'
import type { OpenRPCEnvelopeHandlerPluginOptions, OpenRPCHandlerCodecOptions } from '../standard'
import { NodeHttpHandler } from '@orpc/server/node'
import { StandardHandler } from '@orpc/server/standard'
import { toArray } from '@orpc/shared'
import { OpenRPCEnvelopeHandlerPlugin, OpenRPCHandlerCodec } from '../standard'

export interface OpenRPCHandlerOptions<T extends Context>
  extends NodeHttpHandlerOptions<T>, StandardHandlerOptions<T>, OpenRPCHandlerCodecOptions<T>, OpenRPCEnvelopeHandlerPluginOptions<T> {}

/**
 * Serves oRPC procedures as a JSON-RPC 2.0 API over HTTP POST using Node.js built-in HTTP request/response.
 *
 * @remarks
 * **Note**: When a body parser such as `express.json()` already parsed the body, that parsed body is used,
 * and the body parser handles invalid JSON and content types it does not parse.
 *
 * @see {@link https://orpc.dev/docs/openrpc/handler | OpenRPC Handler}
 */
export class OpenRPCHandler<T extends Context> extends NodeHttpHandler<T> {
  constructor(
    router: Router<T>,
    options: NoInfer<OpenRPCHandlerOptions<T>> = {},
  ) {
    const codec = new OpenRPCHandlerCodec(router, options)
    const handler = new StandardHandler(codec, {
      ...options,
      plugins: [...toArray(options.plugins), new OpenRPCEnvelopeHandlerPlugin(options)],
    })
    super(handler, options)
  }
}
