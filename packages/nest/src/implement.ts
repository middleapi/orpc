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
import { applyDecorators, Delete, Get, Head, HttpCode, HttpException, Inject, Injectable, NotFoundException, Optional, Options, Patch, Post, Put, SetMetadata, StreamableFile, UseInterceptors } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { getPathMeta, ProcedureContract } from '@orpc/contract'
import { DEFAULT_OPENAPI_METHOD, getDynamicPathParams, getOpenAPIMeta } from '@orpc/openapi'
import { OpenAPIHandlerCodecCore } from '@orpc/openapi/standard'
import { DEFAULT_SUCCESS_STATUS, getRouter, Procedure, unlazy } from '@orpc/server'
import { StandardHandler } from '@orpc/server/standard'
import { isAsyncIteratorObject, mergeHttpPath, NullProtoObj, safeEncodeURIComponent, stringifyJSON, value } from '@orpc/shared'
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

const NEST_ROUTE_METADATA_SYMBOL = Symbol('ORPC_NEST_ROUTE')

/**
 * Decorator that implements an oRPC contract (procedure or router contract)
 * on a NestJS controller method. It registers the corresponding NestJS routes
 * and handles request decoding and response encoding for you.
 *
 * @remarks
 * **Note**: Every procedure contract must define an `openapi.path` meta;
 * use `populateRouterContractOpenAPIPaths` from `@orpc/openapi` to fill in missing paths.
 * **Note**: The HTTP `QUERY` method requires NestJS v11.2+ (`QueryMethod`). Older NestJS versions throw; use `GET` instead.
 * **Note**: With the Fastify adapter, `{+name}` must be the last path segment, and literal path text cannot contain route syntax like `:` or `*`.
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
  const route = toContractNestRoute(contract)

  if (meta === undefined || route === undefined) {
    throw new TypeError(`
      @Implement decorator requires contract to have a 'openapi.path' meta.
      Please define one using '.meta(openapi({ path: '/example' }))'.
      Or use "populateRouterContractOpenAPIPaths" from "@orpc/openapi" utility to automatically fill in any missing paths.
    `)
  }

  const method = meta.method ?? DEFAULT_OPENAPI_METHOD
  const path = route.paths.length === 1 ? route.paths[0] : route.paths
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
      SetMetadata(NEST_ROUTE_METADATA_SYMBOL, route),
    )
  }

  return applyDecorators(
    MethodDecoratorMap[method](path),
    HttpCode(successStatus),
    SetMetadata(NEST_ROUTE_METADATA_SYMBOL, route),
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
    const req: ExpressRequest | FastifyRequest = ctx.switchToHttp().getRequest()
    const res: ExpressResponse | FastifyReply = ctx.switchToHttp().getResponse()
    const route: NestRoute | undefined = Reflect.getMetadata(NEST_ROUTE_METADATA_SYMBOL, ctx.getHandler())

    if (route !== undefined && this.hasEmptyRouteParam(route, req)) {
      // OpenAPIHandler does not match empty params, so respond like NestJS does for unmatched routes
      const httpAdapter = this.httpAdapterHost.httpAdapter
      throw new NotFoundException(`Cannot ${httpAdapter.getRequestMethod(req)} ${httpAdapter.getRequestUrl(req)}`)
    }

    return next.handle().pipe(
      mergeMap(async (impl: unknown) => {
        const { default: procedure } = await unlazy(impl)

        if (!(procedure instanceof Procedure)) {
          throw new TypeError(`
            The return value of the @Implement controller handler must be a corresponding implemented router or procedure.
          `)
        }

        const standardRequest = this.toNestStandardLazyRequest(req, res)

        const handler = new StandardHandler({
          resolveProcedure: request => Promise.resolve({
            path: getPathMeta(procedure) ?? [],
            procedure,
            decodeInput: () => this.codec.decodeInput({
              procedure,
              params: toORPCOpenAPIParams(route ?? toContractNestRoute(procedure), standardRequest.params),
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

  /**
   * Express matches an empty trailing catch-all and Fastify also matches empty segments,
   * while OpenAPIHandler requires every param to have a value.
   */
  private hasEmptyRouteParam(route: NestRoute, req: ExpressRequest | FastifyRequest): boolean {
    const type = this.httpAdapterHost.httpAdapter.getType()

    // other adapters may name their params differently
    if (type !== 'express' && type !== 'fastify') {
      return false
    }

    const params = (req.params ?? {}) as Record<string, string | string[] | undefined>
    const catchAllKey = type === 'fastify' ? '*' : 'path'

    return route.params.some(([key]) => {
      const value = params[key ?? catchAllKey]
      return value === undefined || value.length === 0
    })
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

function toORPCOpenAPIParams(route: NestRoute | undefined, params: NestStandardLazyRequest['params']): undefined | Record<string, string> {
  if (!params || Object.keys(params).length === 0) {
    return undefined
  }

  // NullProtoObj prevents prototype injection when a param is named like `__proto__`
  const orpcParams: Record<string, string> = new NullProtoObj()
  // express use `path` while fastify use `*` for a trailing catch-all
  const catchAllKey = Object.hasOwn(params, '*') ? '*' : 'path'
  const names = new Map(route?.params.map(([key, name]) => [key ?? catchAllKey, name]))

  for (const [key, value] of Object.entries(params)) {
    // params outside the contract path, like dynamic controller prefixes, keep their key
    orpcParams[names.get(key) ?? key] = flattenParamValue(value)
  }

  return orpcParams
}

interface NestRoute {
  /**
   * Express matches the percent-encoded request path while Fastify matches the decoded one,
   * so a path with text that clients percent-encode (like `/café`) is also registered in its raw form.
   */
  paths: `/${string}`[]
  /**
   * Keys of the Nest path params mapped to their OpenAPI param names, in path order.
   * A trailing catch-all has no key of its own: Express names it `path` and Fastify `*`.
   */
  params: [key: string | undefined, name: string][]
}

function toContractNestRoute(contract: AnyProcedureContract): NestRoute | undefined {
  const meta = getOpenAPIMeta(contract)

  if (meta?.path === undefined) {
    return undefined
  }

  return toNestRoute(meta.prefix ? mergeHttpPath(meta.prefix, meta.path) : meta.path)
}

// the text clients percent-encode, the same set OpenAPIMatcher stores encoded
const ENCODED_LITERAL_REGEX = /[ "#<>?^`{}\x7F-\uFFFC]+/g
// path-to-regexp (Express) syntax
const EXPRESS_SYNTAX_REGEX = /[\\:*(){}[\]+?!]/g

/**
 * Converts an OpenAPI path to a Nest path that Express routes like OpenAPIHandler:
 * param names become valid keys (`{user-id}` -> `:user_id`) and literal text only matches itself.
 *
 * Fastify routes the same, except that it throws for a catch-all followed by more segments,
 * and does not match literal text holding route syntax like `:`, `*`, `(` or `{`.
 */
function toNestRoute(path: `/${string}`): NestRoute {
  const dynamicParams = getDynamicPathParams(path) ?? []
  const catchAlls = dynamicParams.filter(param => param.allowsSlash)

  if (catchAlls.length > 1) {
    throw new TypeError(`OpenAPI path "${path}" has more than one catch-all param ({+name}), but only one is supported per path.`)
  }

  const catchAll = catchAlls[0]
  const trailingCatchAll = catchAll && ['', '/'].includes(path.slice(catchAll.startIndex + catchAll.segment.length))
    ? catchAll
    : undefined

  const keys = new Map<string, string>()
  // Express names the trailing catch-all `path`
  const usedKeys = new Set(trailingCatchAll ? ['path'] : [])
  const params: NestRoute['params'] = []
  const literals: string[] = []
  const patterns: string[] = []
  let literalStart = 0

  for (const param of dynamicParams) {
    literals.push(path.slice(literalStart, param.startIndex))
    literalStart = param.startIndex + param.segment.length

    if (param === trailingCatchAll) {
      // the only catch-all syntax both adapters support
      params.push([undefined, param.parameterName])
      patterns.push('*')
      continue
    }

    let key = keys.get(param.parameterName)

    if (key === undefined) {
      const base = param.parameterName.replaceAll('-', '_').replace(/^\d/, '_$&')

      key = base
      for (let i = 1; usedKeys.has(key); i++) {
        key = `${base}_${i}`
      }

      keys.set(param.parameterName, key)
      usedKeys.add(key)
    }

    params.push([key, param.parameterName])
    // a catch-all followed by more segments needs Express's named wildcard, which Fastify does not support
    patterns.push(param.allowsSlash ? `*${key}` : `:${key}`)
  }

  literals.push(path.slice(literalStart))

  const join = (texts: string[]) => texts.map((text, i) => text + (patterns[i] ?? '')).join('') as `/${string}`

  const expressPath = join(literals.map(text => text
    .replace(ENCODED_LITERAL_REGEX, safeEncodeURIComponent)
    .replace(EXPRESS_SYNTAX_REGEX, '\\$&'),
  ))

  // the raw path can only be registered when Express reads it literally too
  const rawPath = literals.some(text => text.search(EXPRESS_SYNTAX_REGEX) !== -1) ? undefined : join(literals)

  return {
    paths: rawPath === undefined || rawPath === expressPath ? [expressPath] : [expressPath, rawPath],
    params,
  }
}
