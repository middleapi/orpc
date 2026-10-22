import type { ClientContext } from '@orpc/client'
import type { FetchLinkTransportOptions } from '@orpc/client/fetch'
import type { StandardLinkOptions } from '@orpc/client/standard'
import type { OpenRPCLinkCodecOptions } from '../standard'
import { FetchLinkTransport } from '@orpc/client/fetch'
import { StandardLink } from '@orpc/client/standard'
import { OpenRPCLinkCodec } from '../standard'

export interface OpenRPCLinkOptions<T extends ClientContext>
  extends StandardLinkOptions<T>, FetchLinkTransportOptions<T>, OpenRPCLinkCodecOptions<T> {
}

/**
 * Client link that calls a JSON-RPC 2.0 server, such as `OpenRPCHandler`, over HTTP using the Fetch API.
 * No contract is needed: the procedure path becomes the JSON-RPC method name.
 *
 * @see {@link https://orpc.dev/docs/openrpc/link | OpenRPC Link}
 */
export class OpenRPCLink<T extends ClientContext> extends StandardLink<T> {
  constructor(options: OpenRPCLinkOptions<T> = {}) {
    const codec = new OpenRPCLinkCodec(options)
    const transport = new FetchLinkTransport(options)

    super(codec, transport, options)
  }
}
