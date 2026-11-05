import type { ClientContext } from '../../types.ts'
import type { RPCLinkCodecOptions, StandardLinkOptions } from '../standard/index.ts'
import { RPCLinkCodec, StandardLink } from '../standard/index.ts'
import type { WebSocketLinkTransportOptions } from './transport.ts'
import { WebSocketLinkTransport } from './transport.ts'

export interface RPCLinkOptions<T extends ClientContext>
  extends StandardLinkOptions<T>, WebSocketLinkTransportOptions<T>, RPCLinkCodecOptions<T> {}

/**
 * Client link that communicates with an RPC Handler over a WebSocket connection.
 *
 * @see {@link https://orpc.dev/docs/adapters/websocket | WebSocket Adapters}
 */
export class RPCLink<T extends ClientContext> extends StandardLink<T> {
  constructor(options: RPCLinkOptions<T>) {
    const codec = new RPCLinkCodec(options)
    const transport = new WebSocketLinkTransport(options)
    super(codec, transport, options)
  }
}
