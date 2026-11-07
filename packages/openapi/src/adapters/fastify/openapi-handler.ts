import type { Context, Router } from '@orpc/server'
import type { FastifyHandlerOptions } from '@orpc/server/fastify'
import { FastifyHandler } from '@orpc/server/fastify'
import type { StandardHandlerOptions } from '@orpc/server/standard'
import { StandardHandler } from '@orpc/server/standard'

import type { OpenAPIHandlerCodecOptions } from '../standard/index.ts'
import { OpenAPIHandlerCodec } from '../standard/index.ts'

export interface OpenAPIHandlerOptions<T extends Context>
  extends FastifyHandlerOptions<T>, StandardHandlerOptions<T>, OpenAPIHandlerCodecOptions<T> {}

/**
 * Serves oRPC procedures over the OpenAPI (RESTful) protocol as part of a Fastify server.
 *
 * @see {@link https://orpc.dev/docs/adapters/fastify | Fastify Adapter}
 */
export class OpenAPIHandler<T extends Context> extends FastifyHandler<T> {
  constructor(router: Router<T>, options: NoInfer<OpenAPIHandlerOptions<T>> = {}) {
    const codec = new OpenAPIHandlerCodec(router, options)
    const handler = new StandardHandler(codec, options)
    super(handler, options)
  }
}
