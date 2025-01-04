import type { ConditionalRequestHandler, RequestHandler, RequestOptions } from '@orpc/server/express'
import type { NextFunction, Request, Response } from 'express'
import type { Context } from '../../types'
import { CompositeHandler } from '@orpc/server/express'

export function expressAdapter<T extends Context>(
  handlers: (ConditionalRequestHandler<T> | RequestHandler<T>)[],
  options?: Partial<RequestOptions<T>>,
) {
  const compositeHandler = new CompositeHandler(handlers as ConditionalRequestHandler<T>[])

  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() =>
        compositeHandler.handle(req, res, ...(options ? [options as RequestOptions<T>] : [undefined as any])),
      )
      .then(() => {
        next()
      })
      .catch(next)
  }
}
