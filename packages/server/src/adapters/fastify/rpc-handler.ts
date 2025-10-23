import type { Context } from '../../context'
import type { Router } from '../../router'
import type { StandardRPCHandlerOptions } from '../standard'
import type { FastifyHandlerOptions } from './handler'
import { StrictGetMethodPlugin } from '../../plugins'
import { StandardRPCHandler } from '../standard'
import { FastifyHandler } from './handler'

export interface RPCHandlerOptions<T extends Context> extends FastifyHandlerOptions<T>, StandardRPCHandlerOptions<T> {
  /**
   * Enables or disables the StrictGetMethodPlugin.
   *
   * @default true
   */
  strictGetMethodPluginEnabled?: boolean
}

/**
 * RPC Handler for Fastify Server
 *
 * @see {@link https://orpc.unnoq.com/docs/rpc-handler RPC Handler Docs}
 * @see {@link https://orpc.unnoq.com/docs/adapters/http HTTP Adapter Docs}
 */
export class RPCHandler<T extends Context> extends FastifyHandler<T> {
  constructor(router: Router<any, T>, options: NoInfer<RPCHandlerOptions<T>> = {}) {
    if (options.strictGetMethodPluginEnabled ?? true) {
      options.plugins ??= []
      options.plugins.push(new StrictGetMethodPlugin())
    }

    super(new StandardRPCHandler(router, options), options)
  }
}
