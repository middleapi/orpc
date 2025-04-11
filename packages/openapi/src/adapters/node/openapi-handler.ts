import type { Context, Router } from '@orpc/server'
import type { NodeHttpHandlerOptions } from '@orpc/server/node'
import type { StandardOpenAPIHandlerOptions } from '../standard'
import { NodeHttpHandler } from '@orpc/server/node'
import { StandardOpenAPIHandler } from '../standard'

export class OpenAPIHandler<T extends Context> extends NodeHttpHandler<T> {
  constructor(router: Router<any, T>, options: NoInfer<StandardOpenAPIHandlerOptions<T> & NodeHttpHandlerOptions<T>> = {}) {
    super(new StandardOpenAPIHandler(router, options), options)
  }
}
