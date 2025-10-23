import type { Context, Router } from '@orpc/server'
import type { FastifyHandlerOptions } from '@orpc/server/fastify'
import type { StandardOpenAPIHandlerOptions } from '../standard'
import { FastifyHandler } from '@orpc/server/fastify'
import { StandardOpenAPIHandler } from '../standard'

export interface OpenAPIHandlerOptions<T extends Context> extends FastifyHandlerOptions<T>, StandardOpenAPIHandlerOptions<T> {
}

/**
 * OpenAPI Handler for Fastify Server
 *
 * @see {@link https://orpc.unnoq.com/docs/openapi/openapi-handler OpenAPI Handler Docs}
 * @see {@link https://orpc.unnoq.com/docs/adapters/http HTTP Adapter Docs}
 */
export class OpenAPIHandler<T extends Context> extends FastifyHandler<T> {
  constructor(router: Router<any, T>, options: NoInfer<OpenAPIHandlerOptions<T>> = {}) {
    super(new StandardOpenAPIHandler(router, options), options)
  }
}
