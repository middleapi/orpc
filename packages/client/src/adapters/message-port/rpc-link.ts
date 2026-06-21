import type { ClientContext } from '../../types'
import type { RPCLinkCodecOptions, StandardLinkOptions } from '../standard'
import type { MessagePortLinkTransportOptions } from './transport'
import { RPCLinkCodec, StandardLink } from '../standard'
import { MessagePortLinkTransport } from './transport'

export interface RPCLinkOptions<T extends ClientContext>
  extends StandardLinkOptions<T>, MessagePortLinkTransportOptions<T>, RPCLinkCodecOptions<T> {
}

export class RPCLink<T extends ClientContext> extends StandardLink<T> {
  constructor(options: RPCLinkOptions<T>) {
    const codec = new RPCLinkCodec(options)
    const transport = new MessagePortLinkTransport(options)
    super(codec, transport, options)
  }
}
