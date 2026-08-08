import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import type { AnyProcedureContract, RouterContract } from '@orpc/contract'
import type { ContractedRouter, DefaultInitialContext } from '@orpc/server'
import type { Promisable } from '@orpc/shared'
import type { Observable } from 'rxjs'
import type { ORPCModuleOptions } from './options'
import { applyDecorators, HttpCode, Inject, Injectable, Optional, Post, UseInterceptors } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { getPathMeta, ProcedureContract } from '@orpc/contract'
import { DEFAULT_SUCCESS_STATUS, Procedure, unlazy } from '@orpc/server'
import { RPCHandlerCodecCore, StandardHandler } from '@orpc/server/standard'
import { pathToHttpPath, value } from '@orpc/shared'
import { mergeMap } from 'rxjs'
import { synthesizeControllerMethod } from '../common/implement-utils'
import { handleNestStandardExecution } from '../common/interceptor-utils'
import { defaultToNestStandardLazyRequest } from '../common/lazy-request'
import { ORPC_MODULE_OPTIONS_TOKEN } from './options'

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
        toRpcNestRouteDecorator(contract, propertyKey),
        UseInterceptors(ImplementInterceptor),
      )(target, propertyKey, descriptor)
    }
  }

  return (target, propertyKey, descriptor) => {
    UseInterceptors(ImplementInterceptor)(target, propertyKey, descriptor)
    implementRpcRouterContract(contract, target, propertyKey, descriptor)
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

function toRpcNestRouteDecorator(contract: AnyProcedureContract, fallbackName: string): MethodDecorator {
  const pathMeta = getPathMeta(contract)
  const routePath = pathMeta?.length ? pathToHttpPath(pathMeta) : `/${fallbackName}`

  return applyDecorators(
    Post(routePath),
    HttpCode(DEFAULT_SUCCESS_STATUS),
  )
}

function implementRpcRouterContract(
  contract: RouterContract,
  target: Record<PropertyKey, any>,
  propertyKey: string,
  descriptor: TypedPropertyDescriptor<(...args: any[]) => any>,
): void {
  for (const key in contract) {
    const { methodName, childDescriptor } = synthesizeControllerMethod(target, propertyKey, descriptor, key)
    const childContract = (contract as any)[key]

    if (childContract instanceof ProcedureContract) {
      const pathMeta = getPathMeta(childContract)
      const routePath = pathMeta?.length ? pathToHttpPath(pathMeta) : `/${key}`
      const routeDecorator = applyDecorators(Post(routePath), HttpCode(DEFAULT_SUCCESS_STATUS))

      queueMicrotask(() => {
        routeDecorator(target, methodName, childDescriptor)
      })
    }
    else {
      implementRpcRouterContract(childContract, target, methodName, childDescriptor)
    }
  }
}

@Injectable()
export class ImplementInterceptor implements NestInterceptor {
  private readonly config: ORPCModuleOptions
  private readonly codec: RPCHandlerCodecCore<DefaultInitialContext>
  private readonly toNestStandardLazyRequest: Exclude<ORPCModuleOptions['toNestStandardLazyRequest'], undefined>
  private readonly httpAdapterHost: HttpAdapterHost

  constructor(
    @Inject(ORPC_MODULE_OPTIONS_TOKEN) @Optional() config: ORPCModuleOptions | undefined,
    @Inject(HttpAdapterHost) httpAdapterHost: HttpAdapterHost,
  ) {
    // @Optional() does not allow set default value so we need to do it here
    this.config = (config ?? {}) as ORPCModuleOptions
    this.httpAdapterHost = httpAdapterHost
    this.codec = new RPCHandlerCodecCore(this.config)
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
            decodeInput: () => this.codec.decodeInput({ procedure }, standardRequest),
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
