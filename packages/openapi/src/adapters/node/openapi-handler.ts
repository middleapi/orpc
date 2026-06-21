import type { Context, Router } from '@orpc/server'
import type { NodeHttpHandlerOptions } from '@orpc/server/node'
import type { StandardHandlerOptions } from '@orpc/server/standard'
import type { OpenAPIHandlerCodecOptions } from '../standard'
import { NodeHttpHandler } from '@orpc/server/node'
import { StandardHandler } from '@orpc/server/standard'
import { OpenAPIHandlerCodec } from '../standard'

export interface OpenAPIHandlerOptions<T extends Context>
  extends NodeHttpHandlerOptions<T>, Omit<StandardHandlerOptions<T>, 'plugins'>, OpenAPIHandlerCodecOptions<T> {}

export class OpenAPIHandler<T extends Context> extends NodeHttpHandler<T> {
  constructor(
    router: Router<T>,
    options: NoInfer<OpenAPIHandlerOptions<T>> = {},
  ) {
    const codec = new OpenAPIHandlerCodec(router, options)
    const handler = new StandardHandler(codec, options)
    super(handler, options)
  }
}
