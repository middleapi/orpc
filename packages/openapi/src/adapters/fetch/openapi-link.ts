import type { ClientContext } from '@orpc/client'
import type { FetchLinkTransportOptions } from '@orpc/client/fetch'
import type { StandardLinkOptions } from '@orpc/client/standard'
import type { RouterContract } from '@orpc/contract'
import type { OpenAPILinkCodecOptions } from '../standard'
import { FetchLinkTransport } from '@orpc/client/fetch'
import { StandardLink } from '@orpc/client/standard'
import { OpenAPILinkCodec } from '../standard'

export interface OpenAPILinkOptions<T extends ClientContext>
  extends Omit<StandardLinkOptions<T>, 'plugins'>, FetchLinkTransportOptions<T>, OpenAPILinkCodecOptions<T> {
}

export class OpenAPILink<T extends ClientContext> extends StandardLink<T> {
  constructor(
    router: RouterContract,
    options: OpenAPILinkOptions<T> = {},
  ) {
    const codec = new OpenAPILinkCodec(router, options)
    const transport = new FetchLinkTransport(options)

    super(codec, transport, options)
  }
}
