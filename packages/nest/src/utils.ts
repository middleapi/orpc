import type { AnyContractRouter, HTTPPath } from '@orpc/contract'
import type { StandardBody, StandardHeaders, StandardResponse } from '@orpc/standard-server'
import type { NodeHttpResponse } from '@orpc/standard-server-node'
import type { FastifyReply } from 'fastify/types/reply'
import type { SendStandardResponseOptions } from '../../standard-server-aws-lambda/src'
import { Readable } from 'node:stream'
import { toHttpPath } from '@orpc/client/standard'
import { ContractProcedure, isContractProcedure } from '@orpc/contract'
import { standardizeHTTPPath } from '@orpc/openapi-client/standard'
import { toArray } from '@orpc/shared'
import { toNodeHttpBody } from '@orpc/standard-server-node'

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
  options: SendStandardResponseOptions = { shouldStringifyBody: false },
) {
  if (options.shouldStringifyBody === undefined) {
    options.shouldStringifyBody = false
  }

  return new Promise((resolve, reject) => {
    reply.raw.once('error', reject)
    reply.raw.once('close', resolve)

    const resHeaders: StandardHeaders = { ...standardResponse.headers }

    const resBody = toNodeHttpBody(standardResponse.body, resHeaders, options)

    reply.code(standardResponse.status)
    reply.headers(resHeaders)
    return resolve(resBody)
  })
}

export function setStandardNodeResponse(
  res: NodeHttpResponse,
  standardResponse: StandardResponse,
  options: SendStandardResponseOptions = { shouldStringifyBody: false },
): Promise<void | StandardBody | undefined> {
  if (options.shouldStringifyBody === undefined) {
    options.shouldStringifyBody = false
  }

  return new Promise((resolve, reject) => {
    res.once('error', reject)
    res.once('close', resolve)

    const resHeaders: StandardHeaders = { ...standardResponse.headers }

    const resBody = toNodeHttpBody(standardResponse.body, resHeaders, options)

    res.statusCode = standardResponse.status
    for (const [key, value] of Object.entries(resHeaders)) {
      if (value !== undefined) {
        res.setHeader(key, value)
      }
    }

    if (resBody === undefined) {
      return resolve(undefined)
    }
    else if (resBody instanceof Readable) {
      res.once('close', () => {
        if (!resBody.closed) {
          resBody.destroy(res.errored ?? undefined)
        }
      })

      resBody.once('error', error => res.destroy(error))

      resBody.pipe(res)
    }
    else {
      return resolve(resBody)
    }
  })
}
