import type { Context } from '../../context'
import type { Router } from '../../router'
import type { RPCHandlerCodecOptions, StandardHandlerOptions } from '../standard'
import type { MessagePortHandlerOptions } from './handler'
import { RPCHandlerCodec, StandardHandler } from '../standard'
import { MessagePortHandler } from './handler'

export interface RPCHandlerOptions<T extends Context>
  extends StandardHandlerOptions<T>, Omit<RPCHandlerCodecOptions<T>, 'csrfProtection'>, MessagePortHandlerOptions<T> {}

/**
 * Serves an oRPC router over the RPC protocol on a message port,
 * such as browser extensions, Electron, or worker threads.
 *
 * @see {@link https://orpc.dev/docs/adapters/message-port | Message Port Adapter}
 */
export class RPCHandler<T extends Context> extends MessagePortHandler<T> {
  constructor(
    router: Router<T>,
    options: NoInfer<RPCHandlerOptions<T>> = {},
  ) {
    /**
     * The peer that owns the connection writes every request header itself, so the CSRF
     * protection, which relies on browsers restricting headers cross-site, cannot apply.
     */
    const codec = new RPCHandlerCodec(router, { ...options, csrfProtection: false })
    const handler = new StandardHandler(codec, options)
    super(handler, options)
  }
}
