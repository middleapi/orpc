import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import type { NodeRequest, NodeResponse } from '@nestjs/platform-node'
import type { AnyProcedureContract, RouterContract } from '@orpc/contract'
import type { AnyProcedure, Context, ContractedRouter, DefaultInitialContext } from '@orpc/server'
import type { ResolvedStandardHandlerHandleOptions, StandardHandlerCodec, StandardHandlerCodecResolvedProcedure } from '@orpc/server/standard'
import type { Promisable } from '@orpc/shared'
import type { StandardBodyHint, StandardHeaders, StandardLazyRequest, StandardResponse } from '@standard-server/core'
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Observable } from 'rxjs'
import type { NestStandardLazyRequest, ORPCModuleConfig } from './module'
import { Readable } from 'node:stream'
import * as NestCommon from '@nestjs/common'
import { applyDecorators, Delete, Get, Head, HttpCode, HttpException, Inject, Injectable, Optional, Options, Patch, Post, Put, StreamableFile, UseInterceptors } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { getPathMeta, ProcedureContract } from '@orpc/contract'
import { DEFAULT_OPENAPI_METHOD, getDynamicPathParams, getOpenAPIMeta } from '@orpc/openapi'
import { OpenAPIHandlerCodecCore } from '@orpc/openapi/standard'
import { DEFAULT_SUCCESS_STATUS, getRouter, Procedure, unlazy } from '@orpc/server'
import { StandardHandler } from '@orpc/server/standard'
import { isAsyncIteratorObject, mergeHttpPath, NullProtoObj, stringifyJSON, toArray, value } from '@orpc/shared'
import { flattenStandardHeader, generateContentDisposition, getRequiredStandardBodyHint } from '@standard-server/core'
import { toEventStream, toStandardLazyRequest } from '@standard-server/node'
import { mergeMap } from 'rxjs'

import { ORPC_MODULE_CONFIG_SYMBOL } from './module'

// Namespace access so NestJS < 11.2 (no QueryMethod export) loads without a SyntaxError
const QueryMethod = NestCommon.QueryMethod as typeof NestCommon.QueryMethod | undefined

const MethodDecoratorMap = {
  HEAD: Head,
  GET: Get,
  POST: Post,
  PUT: Put,
  PATCH: Patch,
  DELETE: Delete,
  OPTIONS: Options,
}

/**
 * Decorator that implements an oRPC contract (procedure or router contract)
 * on a NestJS controller method. It registers the corresponding NestJS routes
 * and handles request decoding and response encoding for you.
 *
 * @remarks
 * **Note**: Every procedure contract must define an `openapi.path` meta;
 * use `populateRouterContractOpenAPIPaths` from `@orpc/openapi` to fill in missing paths.
 * **Note**: The HTTP `QUERY` method requires NestJS v11.2+ (`QueryMethod`). Older NestJS versions throw; use `GET` instead.
 *
 * @see {@link https://orpc.dev/docs/integrations/nest#implement-your-contract | Implement oRPC contract with NestJS - Implement Your Contract}
 */
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
        toNestRouteDecorator(contract),
        UseInterceptors(ImplementInterceptor),
      )(target, propertyKey, descriptor)
    }
  }

  return (target, propertyKey, descriptor) => {
    // applied at the decorated method level so interceptor order follows decorator order,
    // and synthesized methods inherit the full ordered list through the prototype chain
    UseInterceptors(ImplementInterceptor)(target, propertyKey, descriptor)

    implementRouterContract(contract, target, propertyKey, descriptor)
  }
}

function toNestRouteDecorator(contract: AnyProcedureContract): MethodDecorator {
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

  if (method === 'QUERY') {
    if (!QueryMethod) {
      throw new TypeError(`
        @Implement decorator does not support the 'QUERY' HTTP method because the installed version of NestJS does not support it.
        The 'QUERY' HTTP method requires NestJS v11.2 or later. Alternatively, use 'GET' method.
      `)
    }

    return applyDecorators(
      QueryMethod(path),
      HttpCode(successStatus),
    )
  }

  return applyDecorators(
    MethodDecoratorMap[method](path),
    HttpCode(successStatus),
  )
}

function implementRouterContract(
  contract: RouterContract,
  target: Record<PropertyKey, any>,
  propertyKey: string,
  descriptor: TypedPropertyDescriptor<(...args: any[]) => any>,
): void {
  for (const [key, childContract] of Object.entries(contract)) {
    let methodName = `${propertyKey}_${key}`

    let i = 0
    while (methodName in target) {
      methodName = `${propertyKey}_${key}_${i++}`
    }

    target[methodName] = async function (...args: any[]) {
      const router = await descriptor.value!.apply(this, args)
      return getRouter(router, [key])
    }

    Object.setPrototypeOf(target[methodName], descriptor.value!)

    queueMicrotask(() => {
      for (const p of Reflect.getOwnMetadataKeys(target, propertyKey)) {
        Reflect.defineMetadata(p, Reflect.getOwnMetadata(p, target, propertyKey), target, methodName)
      }

      for (const p of Reflect.getOwnMetadataKeys(target.constructor, propertyKey)) {
        Reflect.defineMetadata(p, Reflect.getOwnMetadata(p, target.constructor, propertyKey), target.constructor, methodName)
      }
    })

    const childDescriptor = Object.getOwnPropertyDescriptor(target, methodName)!

    if (childContract instanceof ProcedureContract) {
      const routeDecorator = toNestRouteDecorator(childContract)

      // applied after the deferred metadata copies so route metadata cannot be overridden
      queueMicrotask(() => {
        routeDecorator(target, methodName, childDescriptor)
      })
    }
    else {
      implementRouterContract(childContract, target, methodName, childDescriptor)
    }
  }
}

@Injectable()
export class ImplementInterceptor implements NestInterceptor {
  private readonly config: ORPCModuleConfig
  private readonly codec: NestHandlerCodec<DefaultInitialContext>
  private readonly handler: StandardHandler<DefaultInitialContext>
  private readonly toNestStandardLazyRequest: Exclude<ORPCModuleConfig['toNestStandardLazyRequest'], undefined>
  private readonly httpAdapterHost: HttpAdapterHost

  constructor(
    @Inject(ORPC_MODULE_CONFIG_SYMBOL) @Optional() config: ORPCModuleConfig | undefined,
    @Inject(HttpAdapterHost) httpAdapterHost: HttpAdapterHost,
  ) {
    // @Optional() does not allow set default value so we need to do it here
    this.config = config ?? {} as ORPCModuleConfig
    this.httpAdapterHost = httpAdapterHost

    this.codec = new NestHandlerCodec(this.config)
    this.handler = new StandardHandler(this.codec, this.config)
    this.toNestStandardLazyRequest = this.config.toNestStandardLazyRequest ?? ((req: ExpressRequest | FastifyRequest | NodeRequest, res: ExpressResponse | FastifyReply | NodeResponse) => {
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

        const req: ExpressRequest | FastifyRequest | NodeRequest = ctx.switchToHttp().getRequest()
        const res: ExpressResponse | FastifyReply | NodeResponse = ctx.switchToHttp().getResponse()

        const standardRequest = this.toNestStandardLazyRequest(req, res)

        const context = await value(this.config.context ?? {} as DefaultInitialContext, ctx)

        const result = await this.handler.handle(standardRequest, {
          context: this.codec.withMatch(context, { procedure, params: standardRequest.params }),
        })

        if (!result.matched) {
          throw new TypeError(
            'oRPC NestJS handler returned an unmatched result, which should never happen. Please check your plugins/interceptors or report a bug.',
          )
        }

        const [nestBody, headers] = toNestHttpBody(result.response, standardRequest.signal, this.config.toNestResponse)

        const httpAdapter = this.httpAdapterHost.httpAdapter

        httpAdapter.status(res, result.response.status)

        for (const key of Object.keys(headers)) {
          toArray(headers[key]).forEach((value, index) => {
            if (index === 0) {
              httpAdapter.setHeader(res, key, value)
            }
            else {
              httpAdapter.appendHeader(res, key, value)
            }
          })
        }

        if (nestBody instanceof HttpException) {
          throw nestBody
        }

        return nestBody
      }),
    )
  }
}

/**
 * Mirrors `toNodeHttpBody` from `@standard-server/node`, but returns a body NestJS can respond with.
 */
function toNestHttpBody(
  response: StandardResponse,
  signal: AbortSignal | undefined,
  options: ORPCModuleConfig['toNestResponse'],
): [body: unknown, headers: StandardHeaders] {
  const { status, body } = response
  const headers = { ...response.headers }

  if (body instanceof ReadableStream) {
    headers['standard-server'] ??= 'octet-stream' satisfies StandardBodyHint
    headers['content-type'] ??= 'application/octet-stream'
    return [toStreamableFile(Readable.fromWeb(body), headers, signal), headers]
  }

  if (body instanceof Blob) {
    headers['standard-server'] ??= 'file' satisfies StandardBodyHint
    headers['content-type'] ??= body.type
    headers['content-disposition'] ??= generateContentDisposition(body instanceof File ? body.name : 'blob')

    // BunS3 can use NaN for the size
    if (Number.isFinite(body.size)) {
      headers['content-length'] = body.size.toString()
    }

    return [toStreamableFile(Readable.fromWeb(body.stream()), headers, signal), headers]
  }

  headers['standard-server'] = undefined
  headers['content-length'] = undefined

  if (body === undefined) {
    headers['standard-server'] = getRequiredStandardBodyHint('none', headers)
    return [undefined, headers]
  }

  if (body instanceof FormData) {
    const response = new Response(body)
    headers['content-type'] = response.headers.get('content-type')!
    return [toStreamableFile(Readable.fromWeb(response.body!), headers, signal), headers]
  }

  if (body instanceof URLSearchParams) {
    headers['content-type'] ??= 'application/x-www-form-urlencoded'
    headers['standard-server'] = getRequiredStandardBodyHint('url-search-params', headers)
    return [body.toString(), headers]
  }

  if (isAsyncIteratorObject(body)) {
    headers['content-type'] ??= 'text/event-stream'
    headers['standard-server'] = getRequiredStandardBodyHint('event-stream', headers)
    return [toStreamableFile(toEventStream(body, options?.eventStream), headers, signal), headers]
  }

  // Prefer throwing an HttpException for more native error handling in NestJS.
  if (
    status >= 300
    && typeof body === 'object'
    && body !== null
    && !Array.isArray(body)
  ) {
    if (headers['content-type'] !== undefined) {
      headers['standard-server'] = getRequiredStandardBodyHint('json', headers)
    }

    return [new HttpException(body, status), headers]
  }

  headers['content-type'] ??= 'application/json'
  headers['standard-server'] = getRequiredStandardBodyHint('json', headers)
  return [typeof body === 'string' || body === null || headers['standard-server'] !== undefined ? stringifyJSON(body) : body, headers]
}

interface NestHandlerCodecMatch {
  procedure: AnyProcedure
  params: NestStandardLazyRequest['params']
}

class NestHandlerCodec<T extends Context> extends OpenAPIHandlerCodecCore<T> implements StandardHandlerCodec<T> {
  private readonly CONTEXT_SYMBOL = Symbol('ORPC_NEST_HANDLER_CODEC_CONTEXT')

  withMatch(context: T, match: NestHandlerCodecMatch): T {
    return { ...context, [this.CONTEXT_SYMBOL]: match }
  }

  resolveProcedure(request: StandardLazyRequest, options: ResolvedStandardHandlerHandleOptions<T>): StandardHandlerCodecResolvedProcedure | undefined {
    const match = options.context[this.CONTEXT_SYMBOL] as NestHandlerCodecMatch | undefined

    if (!match) {
      return undefined
    }

    const { procedure, params } = match

    return {
      path: getPathMeta(procedure) ?? [],
      procedure,
      decodeInput: () => this.decodeInput({
        procedure,
        params: toORPCOpenAPIParams(procedure, params),
      }, request),
    }
  }
}

/**
 * Destroys the stream once the request is aborted, because Nest's Express adapter only pipes a StreamableFile
 * and never destroys it on client disconnect, which would leave the underlying event iterator or stream uncanceled.
 */
function toStreamableFile(stream: Readable, headers: StandardHeaders, signal: AbortSignal | undefined): StreamableFile {
  const type = flattenStandardHeader(headers['content-type'])
  headers['content-type'] = undefined

  if (signal?.aborted) {
    stream.destroy()
  }
  else {
    signal?.addEventListener('abort', () => stream.destroy(), { once: true })
  }

  return new StreamableFile(stream, { type })
}

function flattenParamValue(value: string | string[]): string {
  return Array.isArray(value) ? value.join('/') : value
}

function toORPCOpenAPIParams(contract: AnyProcedureContract, params: NestStandardLazyRequest['params']): undefined | Record<string, string> {
  const meta = getOpenAPIMeta(contract)

  if (!params || meta?.path === undefined || Object.keys(params).length === 0) {
    return undefined
  }

  // NullProtoObj prevents prototype injection when a param is named like `__proto__`
  const orpcParams: Record<string, string> = new NullProtoObj()
  // express and node use `path` while fastify uses `*` for rest matching
  const restKey = Object.hasOwn(params, '*') ? '*' : 'path'

  for (const [key, value] of Object.entries(params)) {
    if (key === restKey) {
      const restParams = getDynamicPathParams(
        meta.prefix ? mergeHttpPath(meta.prefix, meta.path) : meta.path,
      )?.filter(c => c.allowsSlash)

      if (restParams?.length) {
        for (const c of restParams) {
          orpcParams[c.parameterName] = flattenParamValue(value)
        }

        continue
      }
    }

    orpcParams[key] = flattenParamValue(value)
  }

  return orpcParams
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
