import type { ClientContext } from '../../types'
import type { StandardRPCLinkOptions } from '../standard'
import type { LinkWebsocketClientOptions } from './link-client'
import { StandardRPCLink } from '../standard'
import { LinkWebsocketClient } from './link-client'

export interface RPCLinkOptions<T extends ClientContext>
  extends Omit<StandardRPCLinkOptions<T>, 'url' | 'method' | 'fallbackMethod' | 'maxUrlLength'>, LinkWebsocketClientOptions {}

/**
 * The RPC Link communicates with the server using the RPC protocol over WebSocket.
 *
 * @see {@link https://orpc.unnoq.com/docs/client/rpc-link RPC Link Docs}
 * @see {@link https://orpc.unnoq.com/docs/adapters/websocket WebSocket Adapter Docs}
 */
export class RPCLink<T extends ClientContext> extends StandardRPCLink<T> {
  constructor(options: RPCLinkOptions<T>) {
    const linkClient = new LinkWebsocketClient(options)

    super(linkClient, { ...options, url: 'orpc://localhost' })
  }
}
