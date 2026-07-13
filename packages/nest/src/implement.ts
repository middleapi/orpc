import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import type { AnyProcedureContract, RouterContract } from '@orpc/contract'
import type { ContractedRouter, DefaultInitialContext } from '@orpc/server'
import type { Promisable } from '@orpc/shared'
import type { StandardBodyHint } from '@standardserver/core'
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Observable } from 'rxjs'
import type { NestStandardLazyRequest, ORPCModuleConfig } from './module'
import { Readable } from 'node:stream'
import { applyDecorators, Delete, Get, Head, HttpCode, HttpException, Inject, Injectable, Optional, Options, Patch, Post, Put, StreamableFile, UseInterceptors } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { getPathMeta, ProcedureContract } from '@orpc/contract'
import { DEFAULT_OPENAPI_METHOD, getDynamicPathParams, getOpenAPIMeta } from '@orpc/openapi'
import { OpenAPIHandlerCodecCore } from '@orpc/openapi/standard'
import { DEFAULT_SUCCESS_STATUS, getRouter, Procedure, unlazy } from '@orpc/server'
import { StandardHandler } from '@orpc/server/standard'
import { get, isAsyncIteratorObject, mergeHttpPath, stringifyJSON, value } from '@orpc/shared'
import { flattenStandardHeader, generateContentDisposition } from '@standardserver/core'
import { toEventStream, toStandardLazyRequest } from '@standardserver/node'
import { mergeMap } from 'rxjs'

import { ORPC_MODULE_CONFIG_SYMBOL } from './module'

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
    const meta = getOpenAPIMeta(contract)

    if (meta?.path === undefined) {
      throw new TypeError(`
        @Implement decorator requires contract to have a 'openapi.path' meta.
        Please define one using '.meta(openapi({ path: '/example' }))'.
        Or use "populateRouterContractOpenAPIPaths" from "@orpc/openapi" utility to automatically fill in any missing paths.
      `)
    }

    const method = meta.method ?? DEFAULT_OPENAPI_METHOD
    const path = toNestPattern(meta.prefix ? mergeHttpPath(meta.prefix, meta.path) : meta.path)
    const successStatus = meta.successStatus ?? DEFAULT_SUCCESS_STATUS

    return (target, propertyKey, descriptor) => {
      applyDecorators(
        MethodDecoratorMap[method](path),
        HttpCode(successStatus),
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

@Injectable()
export class ImplementInterceptor implements NestInterceptor {
  private readonly config: ORPCModuleConfig
  private readonly codec: OpenAPIHandlerCodecCore<DefaultInitialContext>
  private readonly toNestStandardLazyRequest: Exclude<ORPCModuleConfig['toNestStandardLazyRequest'], undefined>
  private readonly httpAdapterHost: HttpAdapterHost

  constructor(
    @Inject(ORPC_MODULE_CONFIG_SYMBOL) @Optional() config: ORPCModuleConfig | undefined,
    @Inject(HttpAdapterHost) httpAdapterHost: HttpAdapterHost,
  ) {
    // @Optional() does not allow set default value so we need to do it here
    this.config = config ?? {} as ORPCModuleConfig
    this.httpAdapterHost = httpAdapterHost

    this.codec = new OpenAPIHandlerCodecCore(this.config)
    this.toNestStandardLazyRequest = this.config.toNestStandardLazyRequest ?? ((req: ExpressRequest | FastifyRequest, res: ExpressResponse | FastifyReply) => {
      const standardRequest: NestStandardLazyRequest = toStandardLazyRequest(
        'raw' in req ? req.raw : req,
        'raw' in res ? res.raw : res,
      )

      // if body already parsed by NestJS
      if (req.body !== undefined) {
        standardRequest.resolveBody = () => Promise.resolve(req.body)
      }

      standardRequest.params = req.params as NestStandardLazyRequest['params']

      return standardRequest
    })
  }

  intercept(ctx: ExecutionContext, next: CallHandler<any>): Observable<any> {
    return next.handle().pipe(
      mergeMap(async (impl: unknown) => {
        const { default: procedure } = await unlazy(impl)

        if (!(procedure instanceof Procedure)) {
          throw new TypeError(`
            The return value of the @Implement controller handler must be a corresponding implemented router or procedure.
          `)
        }

        const req: ExpressRequest | FastifyRequest = ctx.switchToHttp().getRequest()
        const res: ExpressResponse | FastifyReply = ctx.switchToHttp().getResponse()

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

        const result = await handler.handle(standardRequest, {
          context: await value(this.config.context ?? {} as DefaultInitialContext, ctx),
        })

        if (!result.matched) {
          throw new TypeError(
            'oRPC NestJS handler returned an unmatched result, which should never happen. Please check your plugins/interceptors or report a bug.',
          )
        }

        const httpAdapter = this.httpAdapterHost.httpAdapter

        httpAdapter.status(res, result.response.status)

        for (const key in result.response.headers) {
          const value = result.response.headers[key]
          if (typeof value === 'string') {
            httpAdapter.setHeader(res, key, value)
          }
          else {
            value?.forEach((value, index) => {
              if (index === 0) {
                httpAdapter.setHeader(res, key, value)
              }
              else {
                httpAdapter.appendHeader(res, key, value)
              }
            })
          }
        }

        const body = result.response.body

        if (body instanceof ReadableStream) {
          httpAdapter.setHeader(res, 'standard-server', 'octet-stream' satisfies StandardBodyHint)
          return new StreamableFile(Readable.fromWeb(body), {
            type: flattenStandardHeader(result.response.headers['content-type']) ?? 'application/octet-stream',
          })
        }

        if (isAsyncIteratorObject(body)) {
          return new StreamableFile(toEventStream(body, this.config.toNestResponse?.eventStream), {
            type: 'text/event-stream',
          })
        }

        if (body instanceof Blob) {
          httpAdapter.setHeader(res, 'standard-server', 'file' satisfies StandardBodyHint) // A File is also a Blob
          return new StreamableFile(Readable.fromWeb(body.stream()), {
            type: body.type,
            disposition: flattenStandardHeader(result.response.headers['content-disposition']) ?? generateContentDisposition(body instanceof File ? body.name : 'blob'),
            // BunS3 can use NaN for the size
            length: Number.isFinite(body.size) ? body.size : undefined,
          })
        }

        if (body instanceof FormData) {
          const response = new Response(body)
          return new StreamableFile(Readable.fromWeb(response.body!), {
            type: response.headers.get('content-type')!,
          })
        }

        if (body instanceof URLSearchParams) {
          httpAdapter.setHeader(res, 'content-type', 'application/x-www-form-urlencoded')
          return body.toString()
        }

        if (body === undefined) {
          return body
        }

        // Prefer throwing an HttpException for more native error handling in NestJS.
        // In oRPC, the error response body is usually a plain object, so this will throw in most cases.
        if (
          result.response.status >= 300
          && typeof body === 'object'
          && body !== null
          && !Array.isArray(body)
        ) {
          throw new HttpException(body, result.response.status)
        }

        httpAdapter.setHeader(res, 'content-type', 'application/json')
        return typeof body === 'string' || body === null
          // NestJS treat string as text response, and null as empty response
          // while it should be treated as JSON response in oRPC
          ? stringifyJSON(body)
          : body // NestJS auto stringify JSON later
      }),
    )
  }
}

function flattenParamValue(value: undefined | string | string[]): undefined | string {
  return Array.isArray(value) ? value.join('/') : value
}

function toORPCOpenAPIParams(contract: AnyProcedureContract, params: NestStandardLazyRequest['params']): undefined | Record<string, string> {
  const meta = getOpenAPIMeta(contract)

  /* c8 ignore start - there cases almost never happen only for type guard purpose */
  if (!params || meta?.path === undefined) {
    return undefined
  }
  /* c8 ignore stop */

  const dynamicParams = getDynamicPathParams(meta.prefix ? mergeHttpPath(meta.prefix, meta.path) : meta.path)
  if (!dynamicParams) {
    return undefined
  }

  return dynamicParams.reduce((acc: Record<string, string>, config) => {
    const value = config.allowsSlash
      ? flattenParamValue(params?.['*'] ?? params?.path) // express use `path` while fastify use `*` for rest matching
      : flattenParamValue(params?.[config.parameterName])

    /* c8 ignore start - this case almost never happen only for type guard purpose */
    if (value === undefined) {
      return acc
    }
    /* c8 ignore stop */

    acc[config.parameterName] = value

    return acc
  }, {})
}

function toNestPattern(path: `/${string}`): `/${string}` {
  const params = getDynamicPathParams(path)

  if (!params?.length) {
    return path
  }

  for (let i = params.length - 1; i >= 0; i--) {
    const param = params[i]!
    const pattern = param.allowsSlash ? `*` : `:${param.parameterName}`
    path = path.slice(0, param.startIndex) + pattern + path.slice(param.startIndex + param.segment.length)
  }

  return path
}
