import type { AnyORPCError, ORPCErrorCode } from '@orpc/client'
import type { AnyProcedureContract, AnySchema, ErrorMap, InferSchemaInput, InferSchemaOutput, ORPCErrorConstructorMap } from '@orpc/contract'
import type { AnyRouter, ProcedureConfig } from '@orpc/server'
import type { FetchHandler } from '@orpc/server/fetch'
import type { Promisable } from '@orpc/shared'
import type { HttpHandler, HttpResponseResolver } from 'msw'
import { getDynamicPathParams, getOpenAPIMeta } from '@orpc/openapi'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { implement } from '@orpc/server'
import { mergeHttpPath, pathToHttpPath } from '@orpc/shared'
import { http, passthrough } from 'msw'

/**
 * The extra request information MSW provides to a response resolver.
 *
 * @see {@link https://orpc.dev/docs/integrations/msw | MSW Integration}
 */
export type ProcedureUtilsResolverInfo = Parameters<HttpResponseResolver>[0]

/**
 * The part of a fetch handler MSW procedure utils rely on to serve mocks.
 *
 * @see {@link https://orpc.dev/docs/integrations/msw | MSW Integration}
 */
export type ProcedureUtilsFetchHandler = Pick<FetchHandler<ProcedureUtilsResolverInfo>, 'handle'>

/**
 * Options for creating MSW procedure utils.
 *
 * @see {@link https://orpc.dev/docs/integrations/msw | MSW Integration}
 */
export interface ProcedureUtilsOptions extends ProcedureConfig {
  /**
   * The origin requests are matched against. Supports MSW wildcards,
   * such as `*` to match any origin.
   *
   * @default ''
   */
  origin?: string

  /**
   * The path prefix procedures are served under, matching the `prefix`
   * the corresponding handler is mounted at in production.
   */
  prefix?: `/${string}`

  /**
   * Creates the fetch handler that serves each mock, using the same
   * configuration as your production handler, such as plugins. When it
   * creates an `OpenAPIHandler`, request URLs are matched using each
   * procedure's route metadata; otherwise, the RPC paths are used.
   *
   * The router passed in contains only the procedure being mocked. Requests
   * the created handler does not match fall through to other MSW handlers.
   *
   * @see {@link https://orpc.dev/docs/integrations/msw#advanced-configuration | MSW Integration - Advanced Configuration}
   */
  handler: (router: AnyRouter) => ProcedureUtilsFetchHandler
}

/**
 * Options passed to a mock procedure handler: the deserialized `input`, the
 * contract's typed `errors` constructors, and the MSW resolver information.
 *
 * @see {@link https://orpc.dev/docs/integrations/msw#mocking-procedures | MSW Integration - Mocking Procedures}
 */
export interface ProcedureUtilsHandlerOptions<
  TInputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
> extends ProcedureUtilsResolverInfo {
  input: InferSchemaOutput<TInputSchema>
  errors: ORPCErrorConstructorMap<TErrorMap>
  signal?: AbortSignal | undefined
  lastEventId?: string | undefined
}

/**
 * A mock procedure handler. Its return value is validated against the
 * contract's output schema before being serialized.
 *
 * @see {@link https://orpc.dev/docs/integrations/msw#mocking-procedures | MSW Integration - Mocking Procedures}
 */
export interface ProcedureUtilsHandler<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
> {
  (
    options: ProcedureUtilsHandlerOptions<TInputSchema, TErrorMap>,
  ): Promisable<AnyORPCError | InferSchemaInput<TOutputSchema>>
}

/**
 * Creates typed MSW request handlers for a procedure-contract. Requests and
 * responses go through a real fetch handler, so serialization, validation,
 * and error envelopes always match the production handler.
 *
 * @see {@link https://orpc.dev/docs/integrations/msw | MSW Integration}
 */
export class ProcedureUtils<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
> {
  private readonly origin: string
  private readonly prefix: `/${string}` | undefined

  constructor(
    private readonly contract: AnyProcedureContract,
    private readonly path: readonly string[],
    private readonly options: ProcedureUtilsOptions,
  ) {
    this.origin = (this.options.origin ?? '').replace(/\/+$/, '')
    this.prefix = this.options.prefix === undefined
      ? undefined
      : `/${this.options.prefix.replace(/\/+$/, '').slice(1)}`
  }

  /**
   * Creates an MSW request handler that resolves the procedure with the given
   * mock implementation.
   *
   * @see {@link https://orpc.dev/docs/integrations/msw#mocking-procedures | MSW Integration - Mocking Procedures}
   */
  handler(handler: ProcedureUtilsHandler<TInputSchema, TOutputSchema, TErrorMap>): HttpHandler {
    const procedure = implement(this.contract, {
      disableInputValidation: this.options.disableInputValidation,
      disableOutputValidation: this.options.disableOutputValidation,
    }).handler(
      ({ context, input, errors, signal, lastEventId }) => handler({
        ...(context as ProcedureUtilsResolverInfo),
        input: input as InferSchemaOutput<TInputSchema>,
        errors,
        signal,
        lastEventId,
      }),
    )

    const fetchHandler = this.options.handler(this.toRouter(procedure))

    return http.all(this.resolveMSWPath(fetchHandler), async (info) => {
      /**
       * The fetch handler consumes the request body, so hand it a clone
       * and keep the original readable for the mock handler.
       */
      const { matched, response } = await fetchHandler.handle(info.request.clone(), {
        prefix: this.prefix,
        context: info,
      })

      return matched ? response : undefined
    })
  }

  /**
   * Creates an MSW request handler that rejects the procedure with an error
   * defined in the contract, serialized exactly like a server-thrown error.
   *
   * @see {@link https://orpc.dev/docs/integrations/msw#mocking-errors | MSW Integration - Mocking Errors}
   */
  error<TCode extends keyof TErrorMap & ORPCErrorCode>(
    code: TCode,
    ...rest: Parameters<ORPCErrorConstructorMap<TErrorMap>[TCode]>
  ): HttpHandler {
    return this.handler(({ errors }) => {
      throw (errors[code] as unknown as (...rest: unknown[]) => AnyORPCError)(...rest)
    })
  }

  /**
   * Creates an MSW request handler that never resolves, useful for testing
   * loading states.
   *
   * @see {@link https://orpc.dev/docs/integrations/msw#mocking-loading-states | MSW Integration - Mocking Loading States}
   */
  loading(): HttpHandler {
    const fetchHandler = this.options.handler(this.toRouter(this.contract))

    return http.all(this.resolveMSWPath(fetchHandler), () => new Promise<never>(() => {}))
  }

  /**
   * Creates an MSW request handler that performs matching requests against
   * the real server as-is, useful to exempt a procedure from mocking.
   *
   * @see {@link https://orpc.dev/docs/integrations/msw#passthrough | MSW Integration - Passthrough}
   */
  passthrough(): HttpHandler {
    const fetchHandler = this.options.handler(this.toRouter(this.contract))

    return http.all(this.resolveMSWPath(fetchHandler), () => passthrough())
  }

  /**
   * Nests the procedure (or its bare contract) back under its path,
   * forming the single-procedure router given to the `handler` option.
   */
  private toRouter(leaf: AnyRouter | AnyProcedureContract): AnyRouter {
    return this.path.reduceRight<AnyRouter>(
      (acc, segment) => ({ [segment]: acc }),
      leaf as AnyRouter,
    )
  }

  /**
   * Resolves the MSW path predicate matching this procedure, following the
   * protocol of the created fetch handler.
   */
  private resolveMSWPath(fetchHandler: ProcedureUtilsFetchHandler): string {
    const isOpenAPI = fetchHandler instanceof OpenAPIHandler
    const httpPath = this.resolveHttpPath(isOpenAPI)
    const dynamicParams = isOpenAPI ? getDynamicPathParams(httpPath) ?? [] : []

    let mswPath: string = httpPath

    for (let i = dynamicParams.length - 1; i >= 0; i--) {
      const param = dynamicParams[i]!
      const pattern = param.allowsSlash ? '*' : `:${param.parameterName}`
      mswPath = mswPath.slice(0, param.startIndex) + pattern + mswPath.slice(param.startIndex + param.segment.length)
    }

    const base = `${this.origin}${this.prefix === undefined || this.prefix === '/' ? '' : this.prefix}`

    return httpPath === '/' ? (base || '/') : `${base}${mswPath}`
  }

  /**
   * Resolves the HTTP path the corresponding handler would serve this
   * procedure at, without any prefix.
   */
  private resolveHttpPath(isOpenAPI: boolean): `/${string}` {
    if (isOpenAPI) {
      const meta = getOpenAPIMeta(this.contract)
      const httpPath = meta?.path ?? pathToHttpPath(this.path)

      return meta?.prefix ? mergeHttpPath(meta.prefix, httpPath) : httpPath
    }

    return pathToHttpPath(this.path)
  }
}
