import type { ClientContext } from '@orpc/client'
import type { FetchLinkTransportOptions } from '@orpc/client/fetch'
import { FetchLinkTransport } from '@orpc/client/fetch'
import type { StandardLinkOptions } from '@orpc/client/standard'
import { StandardLink } from '@orpc/client/standard'
import type { RouterContract } from '@orpc/contract'

import type { OpenAPILinkCodecOptions } from '../standard/index.ts'
import { OpenAPILinkCodec } from '../standard/index.ts'

export interface OpenAPILinkOptions<T extends ClientContext>
  extends StandardLinkOptions<T>, FetchLinkTransportOptions<T>, OpenAPILinkCodecOptions<T> {}

/**
 * Client link that calls an OpenAPI (RESTful) oRPC server over HTTP using the Fetch API.
 *
 * @remarks
 * **Warning**: `fetch` follows redirects by default, so `3xx` responses are never returned.
 * Use a custom `fetch` with `redirect: 'manual'` to get them (server runtimes only).
 *
 * @see {@link https://orpc.dev/docs/openapi/link | OpenAPI Link}
 * @see {@link https://orpc.dev/docs/openapi/link#redirect-responses | OpenAPI Link - Redirect Responses}
 */
export class OpenAPILink<T extends ClientContext> extends StandardLink<T> {
  constructor(router: RouterContract, options: OpenAPILinkOptions<T> = {}) {
    const codec = new OpenAPILinkCodec(router, options)
    const transport = new FetchLinkTransport(options)

    super(codec, transport, options)
  }
}
