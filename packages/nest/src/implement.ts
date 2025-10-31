import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import type { ContractRouter } from '@orpc/contract'
import type { Router } from '@orpc/server'
import type { StandardParams } from '@orpc/server/standard'
import type { Promisable } from '@orpc/shared'
import type { StandardResponse } from '@orpc/standard-server'
import type { Request, Response } from 'express'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Observable } from 'rxjs'
import type { ORPCModuleConfig } from './module'
import { applyDecorators, Delete, Get, Head, Inject, Injectable, Optional, Patch, Post, Put, UseInterceptors } from '@nestjs/common'
import { fallbackContractConfig, isContractProcedure } from '@orpc/contract'
import { StandardBracketNotationSerializer, StandardOpenAPIJsonSerializer, StandardOpenAPISerializer } from '@orpc/openapi-client/standard'
import { StandardOpenAPICodec } from '@orpc/openapi/standard'
import { createProcedureClient, getRouter, isProcedure, ORPCError, unlazy } from '@orpc/server'
import { get } from '@orpc/shared'
import { flattenHeader } from '@orpc/standard-server'
import * as StandardServerFastify from '@orpc/standard-server-fastify'
import * as StandardServerNode from '@orpc/standard-server-node'
import { mergeMap } from 'rxjs'
import { ORPC_MODULE_CONFIG_SYMBOL } from './module'
import { setStandardFastifyResponse, setStandardNodeResponse, toNestPattern } from './utils'

const MethodDecoratorMap = {
  HEAD: Head,
  GET: Get,
  POST: Post,
  PUT: Put,
  PATCH: Patch,
  DELETE: Delete,
}

/**
 * Decorator in controller handler to implement a oRPC contract.
 *
 * @see {@link https://orpc.unnoq.com/docs/openapi/integrations/implement-contract-in-nest#implement-your-contract NestJS Implement Contract Docs}
 */
export function Implement<T extends ContractRouter<any>>(
  contract: T,
): <U extends Promisable<Router<T, Record<never, never>>>>(
  target: Record<PropertyKey, any>,
  propertyKey: string,
  descriptor: TypedPropertyDescriptor<(...args: any[]) => U>,
) => void {
  if (isContractProcedure(contract)) {
    const method = fallbackContractConfig('defaultMethod', contract['~orpc'].route.method)
    const path = contract['~orpc'].route.path

    if (path === undefined) {
      throw new Error(`
        @Implement decorator requires contract to have a 'path'.
        Please define one using 'path' property on the '.route' method.
        Or use "populateContractRouterPaths" utility to automatically fill in any missing paths.
      `)
    }

    return (target, propertyKey, descriptor) => {
      applyDecorators(
        MethodDecoratorMap[method](toNestPattern(path)),
        UseInterceptors(ImplementInterceptor),
      )(target, propertyKey, descriptor)
    }
  }

  return (target, propertyKey, descriptor) => {
    for (const key in contract) {
      let methodName = `${propertyKey}_${key}`

      let i = 0
      while (methodName in target) {
        methodName = `${propertyKey}_${key}_${i++}`
      }

      target[methodName] = async function (...args: any[]) {
        const router = await descriptor.value!.apply(this, args)
        return getRouter(router, [key])
      }

      for (const p of Reflect.getOwnMetadataKeys(target, propertyKey)) {
        Reflect.defineMetadata(p, Reflect.getOwnMetadata(p, target, propertyKey), target, methodName)
      }

      for (const p of Reflect.getOwnMetadataKeys(target.constructor, propertyKey)) {
        Reflect.defineMetadata(p, Reflect.getOwnMetadata(p, target.constructor, propertyKey), target.constructor, methodName)
      }

      Implement(get(contract, [key]) as any)(target, methodName, Object.getOwnPropertyDescriptor(target, methodName)!)
    }
  }
}

const codec = new StandardOpenAPICodec(
  new StandardOpenAPISerializer(
    new StandardOpenAPIJsonSerializer(),
    new StandardBracketNotationSerializer(),
  ),
)

type NestParams = Record<string, string | string[]>

@Injectable()
export class ImplementInterceptor implements NestInterceptor {
  constructor(
    @Inject(ORPC_MODULE_CONFIG_SYMBOL) @Optional() private readonly config: ORPCModuleConfig | undefined,
  ) {
  }

  intercept(ctx: ExecutionContext, next: CallHandler<any>): Observable<any> {
    return next.handle().pipe(
      mergeMap(async (impl: unknown) => {
        const { default: procedure } = await unlazy(impl)

        if (!isProcedure(procedure)) {
          throw new Error(`
            The return value of the @Implement controller handler must be a corresponding implemented router or procedure.
          `)
        }

        const req: Request | FastifyRequest = ctx.switchToHttp().getRequest()
        const res: Response | FastifyReply = ctx.switchToHttp().getResponse()

        const standardRequest = 'raw' in req
          ? StandardServerFastify.toStandardLazyRequest(req, res as FastifyReply)
          : StandardServerNode.toStandardLazyRequest(req, res as Response)

        const client = createProcedureClient(procedure, this.config)

        const standardResponse: StandardResponse = await (async (): Promise<StandardResponse> => {
        // Decode input - catch only non-ORPC decoding errors and convert to ORPCError
          let input: Awaited<ReturnType<typeof codec.decode>>
          try {
            input = await codec.decode(standardRequest, flattenParams(req.params as NestParams), procedure)
          }
          catch (e: any) {
            let error: ORPCError<any, any> = e
            // Malformed request - wrap in ORPCError and let exception filters handle it
            if (!(e instanceof ORPCError)) {
              error = new ORPCError('BAD_REQUEST', {
                message: `Malformed request. Ensure the request body is properly formatted and the 'Content-Type' header is set correctly.`,
                cause: e,
              })
            }
            return codec.encodeError(error)
          }

          // Execute handler - let all errors bubble up to NestJS exception filters
          const output = await client(input, {
            signal: standardRequest.signal,
            lastEventId: flattenHeader(standardRequest.headers['last-event-id']),
          })

          // Encode output - catch only non-ORPC encoding errors and convert to ORPCError
          try {
            return codec.encode(output, procedure)
          }
          catch (e: any) {
            let error: ORPCError<any, any> = e
            // Encoding error means our handler returned invalid data
            if (!(e instanceof ORPCError)) {
              error = new ORPCError('INTERNAL_SERVER_ERROR', {
                message: `Failed to encode response. The handler may have returned data that doesn't match the contract output schema.`,
                cause: e,
              })
            }
            return codec.encodeError(error)
          }
        })()
        // Set status and headers
        if ('raw' in res) {
          return setStandardFastifyResponse(res as FastifyReply, standardResponse, this.config)
        }
        else {
          return setStandardNodeResponse(res as Response, standardResponse, this.config)
        }
      }),
    )
  }
}

function flattenParams(params: NestParams): StandardParams {
  const flatten: StandardParams = {}

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      flatten[key] = value.join('/')
    }
    else {
      flatten[key] = value
    }
  }

  return flatten
}
