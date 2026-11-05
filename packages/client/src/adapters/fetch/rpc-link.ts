import type { ClientContext } from '../../types.ts'
import type { RPCLinkCodecOptions, StandardLinkOptions } from '../standard/index.ts'
import { RPCLinkCodec, StandardLink } from '../standard/index.ts'
import type { FetchLinkTransportOptions } from './transport.ts'
import { FetchLinkTransport } from './transport.ts'

export interface RPCLinkOptions<T extends ClientContext>
  extends StandardLinkOptions<T>, FetchLinkTransportOptions<T>, RPCLinkCodecOptions<T> {}

/**
 * Client link that communicates with an RPC Handler over the Fetch API (HTTP).
 *
 * @see {@link https://orpc.dev/docs/adapters/fetch-api | Fetch API Adapter}
 */
export class RPCLink<T extends ClientContext> extends StandardLink<T> {
  constructor(options: RPCLinkOptions<T>) {
    const codec = new RPCLinkCodec(options)
    const transport = new FetchLinkTransport(options)
    super(codec, transport, options)
  }
}
