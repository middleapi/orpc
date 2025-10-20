import type { Context } from '../../context'
import type { Router } from '../../router'
import type { StandardRPCHandlerOptions } from '../standard'
import type { MessagePortHandlerOptions } from './handler'
import { StandardRPCHandler } from '../standard'
import { MessagePortHandler } from './handler'

export interface RPCHandlerOptions<T extends Context> extends StandardRPCHandlerOptions<T>, MessagePortHandlerOptions<T> {}

/**
 * RPC Handler for common message port implementations.
 *
 * @see {@link https://orpc.unnoq.com/docs/rpc-handler RPC Handler Docs}
 * @see {@link https://orpc.unnoq.com/docs/adapters/message-port Message Port Adapter Docs}
 */
export class RPCHandler<T extends Context> extends MessagePortHandler<T> {
  constructor(router: Router<any, T>, options: NoInfer<RPCHandlerOptions<T>> = {}) {
    super(new StandardRPCHandler(router, options), options)
  }
}
