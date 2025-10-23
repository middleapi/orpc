import type { StandardLazyRequest } from '@orpc/standard-server'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { once } from '@orpc/shared'
import { toAbortSignal, toStandardBody, toStandardMethod, toStandardUrl } from '@orpc/standard-server-node'

export function toStandardLazyRequest(
  req: FastifyRequest,
  reply: FastifyReply,
): StandardLazyRequest {
  const signal = toAbortSignal(reply.raw)

  return {
    method: toStandardMethod(req.raw.method),
    url: toStandardUrl(req.raw),
    headers: req.headers,
    body: once(async () => {
      // prefer fastify parsed body
      if (req.body !== undefined) {
        return req.body
      }

      return toStandardBody(req.raw, { signal })
    }),
    signal,
  }
}
