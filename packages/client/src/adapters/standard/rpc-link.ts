import type { ClientContext } from '../../types'
import type { StandardLinkOptions } from './link'
import type { StandardRPCJsonSerializerOptions } from './rpc-json-serializer'
import type { StandardRPCLinkCodecOptions } from './rpc-link-codec'
import type { StandardLinkClient } from './types'
import { StandardLink } from './link'
import { StandardRPCJsonSerializer } from './rpc-json-serializer'
import { StandardRPCLinkCodec } from './rpc-link-codec'
import { StandardRPCSerializer } from './rpc-serializer'

export interface StandardRPCLinkOptions<T extends ClientContext>
  extends StandardLinkOptions<T>, StandardRPCLinkCodecOptions<T>, StandardRPCJsonSerializerOptions {}

export class StandardRPCLink<T extends ClientContext> extends StandardLink<T> {
  constructor(linkClient: StandardLinkClient<T>, options: StandardRPCLinkOptions<T>) {
    const jsonSerializer = new StandardRPCJsonSerializer(options)
    const serializer = new StandardRPCSerializer(jsonSerializer)
    const linkCodec = new StandardRPCLinkCodec(serializer, options)

    super(linkCodec, linkClient, options)
  }
}
