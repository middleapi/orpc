import type { StandardHeaders, StandardResponse } from '@orpc/standard-server'
import type { ToNodeHttpBodyOptions } from '@orpc/standard-server-node'
import type { FastifyReply } from 'fastify'
import { toNodeHttpBody, toNodeHttpHeaders } from '@orpc/standard-server-node'

export interface SendStandardResponseOptions extends ToNodeHttpBodyOptions { }

export function sendStandardResponse(
  reply: FastifyReply,
  standardResponse: StandardResponse,
  options: SendStandardResponseOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    reply.raw.once('error', reject)
    reply.raw.once('close', resolve)

    const resHeaders: StandardHeaders = { ...standardResponse.headers }

    const resBody = toNodeHttpBody(standardResponse.body, resHeaders, options)

    reply.status(standardResponse.status)
    // Fastify treats undefined headers as empty string, so remember to use toNodeHttpHeaders
    // to filter out undefined headers
    reply.headers(toNodeHttpHeaders(resHeaders))
    reply.send(resBody)
  })
}
