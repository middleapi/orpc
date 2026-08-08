import type { Request as ExpressRequest, Response as ExpressResponse } from 'express'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { NestStandardLazyRequest } from './types'
import { toStandardLazyRequest } from '@standardserver/node'

export function defaultToNestStandardLazyRequest(
  req: ExpressRequest | FastifyRequest,
  res: ExpressResponse | FastifyReply,
): NestStandardLazyRequest {
  const standardRequest: NestStandardLazyRequest = toStandardLazyRequest(
    'raw' in req ? req.raw : req,
    'raw' in res ? res.raw : res,
  )

  if (req.body !== undefined) {
    standardRequest.resolveBody = () => Promise.resolve(req.body)
  }

  standardRequest.params = req.params as NestStandardLazyRequest['params']

  return standardRequest
}
