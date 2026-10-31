import type { ClientContext } from '@orpc/client'
import type { StandardLinkOptions } from '@orpc/client/standard'
import type { OpenRPCLinkCodecOptions } from '../standard'
import type { OpenRPCWebSocketLinkTransportOptions } from './transport'
import { StandardLink } from '@orpc/client/standard'
import { OpenRPCLinkCodec } from '../standard'
import { OpenRPCWebSocketLinkTransport } from './transport'

export interface OpenRPCLinkOptions<T extends ClientContext>
  extends StandardLinkOptions<T>, OpenRPCWebSocketLinkTransportOptions, Pick<OpenRPCLinkCodecOptions<T>, 'serializer'> {}

/**
 * Client link that calls a JSON-RPC 2.0 server, such as `OpenRPCHandler`, over a WebSocket connection.
 *
 * @see {@link https://orpc.dev/docs/openrpc/link#websocket | OpenRPC Link - WebSocket}
 */
export class OpenRPCLink<T extends ClientContext> extends StandardLink<T> {
  constructor(options: OpenRPCLinkOptions<T>) {
    super(new OpenRPCLinkCodec(options), new OpenRPCWebSocketLinkTransport(options), options)
  }
}
