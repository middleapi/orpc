import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import type { AnyProcedureContract, RouterContract } from '@orpc/contract'
import type { ContractedRouter, DefaultInitialContext } from '@orpc/server'
import type { Promisable } from '@orpc/shared'
import type { StandardBodyHint } from '@standard-server/core'
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
import { isAsyncIteratorObject, mergeHttpPath, NullProtoObj, stringifyJSON, value } from '@orpc/shared'
import { flattenStandardHeader, generateContentDisposition } from '@standard-server/core'
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
  const path = getNestRoute(meta.path, meta.prefix).pattern
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
          resolveProcedure: request => Promise.resolve({
            path: getPathMeta(procedure) ?? [],
            procedure,
            decodeInput: () => this.codec.decodeInput({
              procedure,
              params: toORPCOpenAPIParams(procedure, standardRequest.params),
            }, request),
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

        for (const key of Object.keys(result.response.headers)) {
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
          return toStreamableFile(Readable.fromWeb(body), standardRequest.signal, {
            type: flattenStandardHeader(result.response.headers['content-type']) ?? 'application/octet-stream',
          })
        }

        if (isAsyncIteratorObject(body)) {
          return toStreamableFile(toEventStream(body, this.config.toNestResponse?.eventStream), standardRequest.signal, {
            type: 'text/event-stream',
          })
        }

        if (body instanceof Blob) {
          httpAdapter.setHeader(res, 'standard-server', 'file' satisfies StandardBodyHint) // A File is also a Blob
          return toStreamableFile(Readable.fromWeb(body.stream()), standardRequest.signal, {
            type: body.type,
            disposition: flattenStandardHeader(result.response.headers['content-disposition']) ?? generateContentDisposition(body instanceof File ? body.name : 'blob'),
            // BunS3 can use NaN for the size
            length: Number.isFinite(body.size) ? body.size : undefined,
          })
        }

        if (body instanceof FormData) {
          const response = new Response(body)
          return toStreamableFile(Readable.fromWeb(response.body!), standardRequest.signal, {
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

/**
 * Destroys the stream once the request is aborted, because Nest's Express adapter only pipes a StreamableFile
 * and never destroys it on client disconnect, which would leave the underlying event iterator or stream uncanceled.
 */
function toStreamableFile(stream: Readable, signal: AbortSignal | undefined, options: StreamableFile['options']): StreamableFile {
  if (signal?.aborted) {
    stream.destroy()
  }
  else {
    signal?.addEventListener('abort', () => stream.destroy(), { once: true })
  }

  return new StreamableFile(stream, options)
}

function flattenParamValue(value: string | string[]): string {
  return Array.isArray(value) ? value.join('/') : value
}

function toORPCOpenAPIParams(contract: AnyProcedureContract, params: NestStandardLazyRequest['params']): undefined | Record<string, string> {
  const meta = getOpenAPIMeta(contract)

  if (!params || meta?.path === undefined || Object.keys(params).length === 0) {
    return undefined
  }

  const { aliases } = getNestRoute(meta.path, meta.prefix)
  // only fastify reports the trailing wildcard as `*`, and there a `path` key is a literal param (e.g. from a controller prefix)
  const hasFastifyWildcard = Object.hasOwn(params, '*')

  // NullProtoObj prevents prototype injection when a param is named like `__proto__`
  const orpcParams: Record<string, string> = new NullProtoObj()

  for (const [key, value] of Object.entries(params)) {
    const name = key === 'path' && hasFastifyWildcard ? key : aliases[key] ?? key
    orpcParams[name] = flattenParamValue(value)
  }

  return orpcParams
}

const NEST_PATH_PARAM_NAME = 'orpc_path'

interface NestRoute {
  pattern: `/${string}`
  /**
   * Maps Nest param keys that differ from their contract param name back to it, other keys are kept as is.
   */
  aliases: Record<string, string>
}

const nestRoutes = new Map<string, NestRoute>()

/**
 * Cached, since the params of every request are mapped back through the route of its contract.
 */
function getNestRoute(path: `/${string}`, prefix: `/${string}` | undefined): NestRoute {
  const fullPath = prefix ? mergeHttpPath(prefix, path) : path
  let route = nestRoutes.get(fullPath)

  if (!route) {
    route = toNestRoute(fullPath)
    nestRoutes.set(fullPath, route)
  }

  return route
}

/**
 * Converts an oRPC OpenAPI path into a Nest route, keeping contract param names unless a Nest adapter forces a rename.
 */
function toNestRoute(path: `/${string}`): NestRoute {
  const dynamicParams = getDynamicPathParams(path)
  const aliases: Record<string, string> = new NullProtoObj()

  if (!dynamicParams) {
    return { pattern: path, aliases }
  }

  // Fastify only accepts the unnamed `*`, and only at the end of a route. It arrives as `*` on Fastify
  // and as `path` on Express, because Nest's LegacyRouteConverter rewrites a trailing `*` to `{*path}`.
  const lastParam = dynamicParams.at(-1)!
  const trailingRest = lastParam.allowsSlash && lastParam.startIndex + lastParam.segment.length === path.length
    ? lastParam
    : undefined

  let pattern = ''
  let literalStart = 0

  for (const param of dynamicParams) {
    pattern += path.slice(literalStart, param.startIndex)
    literalStart = param.startIndex + param.segment.length

    if (param === trailingRest) {
      pattern += '*'
      aliases['*'] = param.parameterName
      aliases.path = param.parameterName
    }
    else if (param.allowsSlash) {
      // Nest's LegacyRouteConverter names an unnamed mid-path `*` after its offset in the full route (e.g. `*path6`),
      // so name it after the contract param instead. Only Express supports this, Fastify refuses to register the route.
      pattern += `*${param.parameterName}`
    }
    else if (trailingRest && param.parameterName === 'path') {
      // the trailing `*` becomes `{*path}` on Express, which would overwrite this param
      pattern += `:${NEST_PATH_PARAM_NAME}`
      aliases[NEST_PATH_PARAM_NAME] = param.parameterName
    }
    else {
      pattern += `:${param.parameterName}`
    }
  }

  pattern += path.slice(literalStart)

  return { pattern: pattern as `/${string}`, aliases }
}
