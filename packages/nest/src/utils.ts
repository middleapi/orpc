import type { AnyContractRouter, HTTPPath } from '@orpc/contract'
import type { StandardBody, StandardHeaders, StandardResponse } from '@orpc/standard-server'
import type { NodeHttpResponse, ToNodeHttpBodyOptions } from '@orpc/standard-server-node'
import type { FastifyReply } from 'fastify/types/reply'
import { Blob } from 'node:buffer'
import { Readable } from 'node:stream'
import { toHttpPath } from '@orpc/client/standard'
import { ContractProcedure, isContractProcedure } from '@orpc/contract'
import { standardizeHTTPPath } from '@orpc/openapi-client/standard'
import { isAsyncIteratorObject, omit, stringifyJSON, toArray } from '@orpc/shared'
import { flattenHeader, generateContentDisposition } from '@orpc/standard-server'
import { toEventStream } from '@orpc/standard-server-node'

export function toNestPattern(path: HTTPPath): string {
  return standardizeHTTPPath(path)
    .replace(/\/\{\+([^}]+)\}/g, '/*$1')
    .replace(/\/\{([^}]+)\}/g, '/:$1')
}

export type PopulatedContractRouterPaths<T extends AnyContractRouter>
  = T extends ContractProcedure<infer UInputSchema, infer UOutputSchema, infer UErrors, infer UMeta>
    ? ContractProcedure<UInputSchema, UOutputSchema, UErrors, UMeta>
    : {
        [K in keyof T]: T[K] extends AnyContractRouter ? PopulatedContractRouterPaths<T[K]> : never
      }

export interface PopulateContractRouterPathsOptions {
  path?: readonly string[]
}

/**
 * populateContractRouterPaths is completely optional,
 * because the procedure's path is required for NestJS implementation.
 * This utility automatically populates any missing paths
 * Using the router's keys + `/`.
 *
 * @see {@link https://orpc.unnoq.com/docs/openapi/integrations/implement-contract-in-nest#define-your-contract NestJS Implement Contract Docs}
 */
export function populateContractRouterPaths<T extends AnyContractRouter>(router: T, options: PopulateContractRouterPathsOptions = {}): PopulatedContractRouterPaths<T> {
  const path = toArray(options.path)

  if (isContractProcedure(router)) {
    if (router['~orpc'].route.path === undefined) {
      return new ContractProcedure({
        ...router['~orpc'],
        route: {
          ...router['~orpc'].route,
          path: toHttpPath(path),
        },
      }) as any
    }

    return router as any
  }

  const populated: Record<string, any> = {}

  for (const key in router) {
    populated[key] = populateContractRouterPaths(router[key]!, { ...options, path: [...path, key] })
  }

  return populated as any
}

export function setStandardFastifyResponse(
  reply: FastifyReply,
  standardResponse: StandardResponse,
  options: ToNodeHttpBodyOptions = {},
) {
  return new Promise((resolve, reject) => {
    reply.raw.once('error', reject)
    reply.raw.once('close', resolve)

    const { headers, body } = getStandardHttpBodyAndHeaders(standardResponse.body, standardResponse.headers, options)

    reply.code(standardResponse.status)
    reply.headers(headers)
    return resolve(body)
  })
}

export function setStandardNodeResponse(
  res: NodeHttpResponse,
  standardResponse: StandardResponse,
  options: ToNodeHttpBodyOptions = {},
): Promise<void | StandardBody | undefined> {
  return new Promise((resolve, reject) => {
    res.once('error', reject)
    res.once('close', resolve)

    const { headers, body } = getStandardHttpBodyAndHeaders(standardResponse.body, standardResponse.headers, options)

    res.statusCode = standardResponse.status
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) {
        res.setHeader(key, value)
      }
    }

    if (body === undefined) {
      return resolve(undefined)
    }
    else if (body instanceof Readable) {
      res.once('close', () => {
        if (!body.closed) {
          body.destroy(res.errored ?? undefined)
        }
      })

      body.once('error', error => res.destroy(error))

      body.pipe(res)
      body.once('end', () => resolve(undefined))
    }
    else {
      return resolve(body)
    }
  })
}

export function getStandardHttpBodyAndHeaders(
  body: StandardBody,
  headers: StandardHeaders,
  options: ToNodeHttpBodyOptions = {},
): { body: Readable | undefined | string, headers: StandardHeaders } {
  const newHeaders: StandardHeaders = { ...omit(headers, ['content-disposition', 'content-type']) }

  if (body === undefined) {
    return { body: undefined, headers: newHeaders }
  }

  if (body instanceof Blob) {
    newHeaders['content-type'] = body.type
    newHeaders['content-length'] = body.size.toString()
    const currentContentDisposition = flattenHeader(headers['content-disposition'])
    newHeaders['content-disposition'] = currentContentDisposition ?? generateContentDisposition(body instanceof File ? body.name : 'blob')

    return { body: Readable.fromWeb(body.stream()), headers: newHeaders }
  }

  if (body instanceof FormData) {
    const response = new Response(body)
    newHeaders['content-type'] = response.headers.get('content-type')!
    // The FormData type inferred is from React and not NodeJS, so we need to cast it
    return { body: Readable.fromWeb(response.body as any), headers: newHeaders }
  }

  if (body instanceof URLSearchParams) {
    newHeaders['content-type'] = 'application/x-www-form-urlencoded'

    return { body: body.toString(), headers: newHeaders }
  }

  if (isAsyncIteratorObject(body)) {
    newHeaders['content-type'] = 'text/event-stream'

    return { body: toEventStream(body, options), headers: newHeaders }
  }

  newHeaders['content-type'] = 'application/json'
  // It seems like Nest/Node, in case of a string body, remove or alter the string if
  // content type json is not set.
  // We also need to "double" stringify it, else the string will be encoded as an Array
  // This match the behavior of #toNodeHttpBody
  if (typeof body === 'string') {
    return { body: stringifyJSON(body), headers: newHeaders }
  }

  return { body: body as unknown as string, headers: newHeaders }
}
