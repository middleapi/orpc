import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '../../types'
import type { ConditionalRequestHandler, RequestHandler, RequestOptions } from './types'

export class CompositeHandler<T extends Context> implements RequestHandler<T> {
  constructor(
    private readonly handlers: ConditionalRequestHandler<T>[],
  ) {}

  async handle(req: IncomingMessage, res: ServerResponse, ...opt: [options: RequestOptions<T>] | (undefined extends T ? [] : never)): Promise<void> {
    const len = this.handlers.length
    const handlers = this.handlers

    if (len > 0) {
      const handler = handlers[0]!
      if (handler.condition(req)) {
        return handler.handle(req, res, ...opt)
      }
    }

    for (let i = 1; i < len; i++) {
      const handler = handlers[i]!
      if (handler.condition(req)) {
        return handler.handle(req, res, ...opt)
      }
    }

    res.statusCode = 404
  }
}
