import type { Context } from '../../context'
import type { Router } from '../../router'
import type { RPCHandlerCodecOptions, StandardHandlerOptions } from '../standard'
import type { WebSocketHandlerOptions } from './handler'
import { RPCHandlerCodec, StandardHandler } from '../standard'
import { WebSocketHandler } from './handler'

export interface RPCHandlerOptions<T extends Context>
  extends StandardHandlerOptions<T>, Omit<RPCHandlerCodecOptions<T>, 'csrfProtection'>, WebSocketHandlerOptions<T> {}

/**
 * Serves an oRPC router over the RPC protocol on a standard WebSocket
 * connection (Deno, Bun, Cloudflare Durable Objects, and more).
 *
 * @see {@link https://orpc.dev/docs/adapters/websocket | WebSocket Adapters}
 */
export class RPCHandler<T extends Context> extends WebSocketHandler<T> {
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
