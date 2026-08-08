import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import type { AnyProcedureContract, RouterContract } from '@orpc/contract'
import type { ContractedRouter, DefaultInitialContext } from '@orpc/server'
import type { Promisable } from '@orpc/shared'
import type { Observable } from 'rxjs'
import type { ORPCModuleOptions } from './options'
import { applyDecorators, Delete, Get, Head, HttpCode, Inject, Injectable, Optional, Options, Patch, Post, Put, UseInterceptors } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { getPathMeta, ProcedureContract } from '@orpc/contract'
import { DEFAULT_OPENAPI_METHOD, getDynamicPathParams, getOpenAPIMeta } from '@orpc/openapi'
import { OpenAPIHandlerCodecCore } from '@orpc/openapi/standard'
import { DEFAULT_SUCCESS_STATUS, Procedure, unlazy } from '@orpc/server'
import { StandardHandler } from '@orpc/server/standard'
import { mergeHttpPath, NullProtoObj, value } from '@orpc/shared'
import { mergeMap } from 'rxjs'
import { synthesizeControllerMethod } from '../common/implement-utils'
import { handleNestStandardExecution } from '../common/interceptor-utils'
import { defaultToNestStandardLazyRequest } from '../common/lazy-request'
import { ORPC_MODULE_OPTIONS_TOKEN } from './options'

const MethodDecoratorMap = {
  HEAD: Head,
  GET: Get,
  POST: Post,
  PUT: Put,
  PATCH: Patch,
  DELETE: Delete,
  OPTIONS: Options,
}

export function Implement<T extends RouterContract>(
  contract: T,
): <U extends Promisable<ContractedRouter<T, DefaultInitialContext>>>(
  target: Record<PropertyKey, any>,
  propertyKey: string,
  descriptor: TypedPropertyDescriptor<(...args: any[]) => U>,
) => void {
  if (contract instanceof ProcedureContract) {
    return (target, propertyKey, descriptor) => {
      applyDecorators(
        toOpenAPINestRouteDecorator(contract),
        UseInterceptors(ImplementInterceptor),
      )(target, propertyKey, descriptor)
    }
  }

  return (target, propertyKey, descriptor) => {
    UseInterceptors(ImplementInterceptor)(target, propertyKey, descriptor)
    implementOpenAPIRouterContract(contract, target, propertyKey, descriptor)
  }
}

export function Impl<T extends RouterContract>(
  contract: T,
): <U extends Promisable<ContractedRouter<T, DefaultInitialContext>>>(
  target: Record<PropertyKey, any>,
  propertyKey: string,
  descriptor: TypedPropertyDescriptor<(...args: any[]) => U>,
) => void {
  return Implement(contract)
}

function toOpenAPINestRouteDecorator(contract: AnyProcedureContract): MethodDecorator {
  const meta = getOpenAPIMeta(contract)

  if (meta?.path === undefined) {
    throw new TypeError(`
      @Implement decorator in @orpc/nest/openapi requires contract to have an 'openapi.path' meta.
      Please define one using '.meta(openapi({ path: '/example' }))'.
      Or use "populateRouterContractOpenAPIPaths" from "@orpc/openapi" utility to automatically fill in any missing paths.
    `)
  }

  const method = meta.method ?? DEFAULT_OPENAPI_METHOD
  const path = toNestPattern(meta.prefix ? mergeHttpPath(meta.prefix, meta.path) : meta.path)
  const successStatus = meta.successStatus ?? DEFAULT_SUCCESS_STATUS

  return applyDecorators(
    MethodDecoratorMap[method](path),
    HttpCode(successStatus),
  )
}

function implementOpenAPIRouterContract(
  contract: RouterContract,
  target: Record<PropertyKey, any>,
  propertyKey: string,
  descriptor: TypedPropertyDescriptor<(...args: any[]) => any>,
): void {
  for (const key in contract) {
    const { methodName, childDescriptor } = synthesizeControllerMethod(target, propertyKey, descriptor, key)
    const childContract = (contract as any)[key]

    if (childContract instanceof ProcedureContract) {
      const routeDecorator = toOpenAPINestRouteDecorator(childContract)
      queueMicrotask(() => {
        routeDecorator(target, methodName, childDescriptor)
      })
    }
    else {
      implementOpenAPIRouterContract(childContract, target, methodName, childDescriptor)
    }
  }
}

@Injectable()
export class ImplementInterceptor implements NestInterceptor {
  private readonly config: ORPCModuleOptions
  private readonly codec: OpenAPIHandlerCodecCore<DefaultInitialContext>
  private readonly toNestStandardLazyRequest: Exclude<ORPCModuleOptions['toNestStandardLazyRequest'], undefined>
  private readonly httpAdapterHost: HttpAdapterHost

  constructor(
    @Inject(ORPC_MODULE_OPTIONS_TOKEN) @Optional() config: ORPCModuleOptions | undefined,
    @Inject(HttpAdapterHost) httpAdapterHost: HttpAdapterHost,
  ) {
    this.config = config ?? {}
    this.httpAdapterHost = httpAdapterHost
    this.codec = new OpenAPIHandlerCodecCore(this.config)
    this.toNestStandardLazyRequest = this.config.toNestStandardLazyRequest ?? defaultToNestStandardLazyRequest
  }

  intercept(ctx: ExecutionContext, next: CallHandler<any>): Observable<any> {
    return next.handle().pipe(
      mergeMap(async (impl: unknown) => {
        const { default: procedure } = await unlazy(impl)

        if (!(procedure instanceof Procedure)) {
          throw new TypeError(`The return value of the @Implement controller handler must be a corresponding implemented procedure.`)
        }

        const req = ctx.switchToHttp().getRequest()
        const res = ctx.switchToHttp().getResponse()
        const standardRequest = this.toNestStandardLazyRequest(req, res)

        const handler = new StandardHandler({
          resolveProcedure: () => Promise.resolve({
            path: getPathMeta(procedure) ?? [],
            procedure,
            decodeInput: () => this.codec.decodeInput({
              procedure,
              params: toORPCOpenAPIParams(procedure, standardRequest.params),
            }, standardRequest),
          }),
          encodeError: this.codec.encodeError.bind(this.codec),
          encodeOutput: this.codec.encodeOutput.bind(this.codec),
        }, this.config)

        const initialContext = await value(this.config.context ?? {}, ctx)

        return handleNestStandardExecution(
          handler,
          standardRequest,
          initialContext,
          res,
          this.httpAdapterHost.httpAdapter,
          this.config.toNestResponse,
        )
      }),
    )
  }
}

function toORPCOpenAPIParams(contract: AnyProcedureContract, params: any): Record<string, string> | undefined {
  const meta = getOpenAPIMeta(contract)
  if (!params || meta?.path === undefined || Object.keys(params).length === 0) {
    return undefined
  }

  const orpcParams: Record<string, string> = new NullProtoObj()
  const restKey = Object.hasOwn(params, '*') ? '*' : 'path'

  for (const [key, val] of Object.entries(params)) {
    if (key === restKey) {
      const restParams = getDynamicPathParams(meta.prefix ? mergeHttpPath(meta.prefix, meta.path) : meta.path)?.filter(c => c.allowsSlash)
      if (restParams?.length) {
        for (const c of restParams) {
          orpcParams[c.parameterName] = Array.isArray(val) ? val.join('/') : val as string
        }
        continue
      }
    }
    orpcParams[key] = Array.isArray(val) ? val.join('/') : val as string
  }

  return orpcParams
}

function toNestPattern(path: `/${string}`): `/${string}` {
  const params = getDynamicPathParams(path)
  if (!params?.length)
    return path

  for (let i = params.length - 1; i >= 0; i--) {
    const param = params[i]!
    const pattern = param.allowsSlash ? `*` : `:${param.parameterName}`
    path = path.slice(0, param.startIndex) + pattern + path.slice(param.startIndex + param.segment.length) as `/${string}`
  }

  return path
}
