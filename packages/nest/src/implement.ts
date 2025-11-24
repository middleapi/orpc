import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import type { ContractRouter } from '@orpc/contract'
import type { Router } from '@orpc/server'
import type { StandardParams } from '@orpc/server/standard'
import type { Promisable } from '@orpc/shared'
import type { Request, Response } from 'express'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Observable } from 'rxjs'
import type { ORPCModuleConfig } from './module'
import { applyDecorators, Delete, Get, Head, Inject, Injectable, Optional, Patch, Post, Put, UseInterceptors } from '@nestjs/common'
import { fallbackContractConfig, isContractProcedure } from '@orpc/contract'
import { StandardBracketNotationSerializer, StandardOpenAPIJsonSerializer, StandardOpenAPISerializer } from '@orpc/openapi-client/standard'
import { StandardOpenAPICodec } from '@orpc/openapi/standard'
import { getRouter, isProcedure, unlazy } from '@orpc/server'
import { StandardHandler } from '@orpc/server/standard'
import { clone, get } from '@orpc/shared'
import * as StandardServerFastify from '@orpc/standard-server-fastify'
import * as StandardServerNode from '@orpc/standard-server-node'
import { mergeMap } from 'rxjs'
import { ORPC_MODULE_CONFIG_SYMBOL } from './module'
import { toNestPattern } from './utils'

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

type NestParams = Record<string, string | string[]>

@Injectable()
export class ImplementInterceptor implements NestInterceptor {
  private readonly config: ORPCModuleConfig

  constructor(
    @Inject(ORPC_MODULE_CONFIG_SYMBOL) @Optional() config: ORPCModuleConfig | undefined,
  ) {
    // @Optional() doesn't support default values, so we handle it here.
    // We clone the config to prevent conflicts when multiple handlers
    // modify the same object through the plugins system.
    // TODO: improve plugins system to avoid mutating config directly.
    this.config = clone(config) ?? {}
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

        const codec = new StandardOpenAPICodec(
          new StandardOpenAPISerializer(
            new StandardOpenAPIJsonSerializer(this.config),
            new StandardBracketNotationSerializer(this.config),
          ),
        )

        const handler = new StandardHandler(procedure, {
          init: () => {},
          match: () => Promise.resolve({ path: [], procedure, params: flattenParams(req.params as NestParams) }),
        }, codec, this.config)

        const result = await handler.handle(standardRequest, {
          context: this.config.context,
        })

        if (result.matched) {
          if ('raw' in res) {
            await StandardServerFastify.sendStandardResponse(res, result.response, this.config)
          }
          else {
            await StandardServerNode.sendStandardResponse(res, result.response, this.config)
          }
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
