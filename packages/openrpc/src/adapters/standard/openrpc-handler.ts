import type { Context, Router } from '@orpc/server'
import type { StandardHandlerOptions } from '@orpc/server/standard'
import type { OpenRPCEnvelopeHandlerPluginOptions } from './openrpc-envelope-handler-plugin'
import type { OpenRPCHandlerCodecOptions } from './openrpc-handler-codec'
import { StandardHandler } from '@orpc/server/standard'
import { toArray } from '@orpc/shared'
import { OpenRPCEnvelopeHandlerPlugin } from './openrpc-envelope-handler-plugin'
import { OpenRPCHandlerCodec } from './openrpc-handler-codec'

export interface StandardOpenRPCHandlerOptions<T extends Context>
  extends StandardHandlerOptions<T>, OpenRPCHandlerCodecOptions<T>, OpenRPCEnvelopeHandlerPluginOptions<T> {}

/**
 * The `StandardHandler` every `OpenRPCHandler` adapter is built on: the OpenRPC codec, paired with the envelope plugin it needs.
 */
export class StandardOpenRPCHandler<T extends Context> extends StandardHandler<T> {
  constructor(router: Router<T>, options: NoInfer<StandardOpenRPCHandlerOptions<T>> = {}) {
    super(new OpenRPCHandlerCodec(router, options), {
      ...options,
      plugins: [...toArray(options.plugins), new OpenRPCEnvelopeHandlerPlugin(options)],
    })
  }
}
