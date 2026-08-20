import type { AnyORPCError, ORPCErrorCode } from '@orpc/client'
import type { AnyProcedureContract, AnySchema, ErrorMap, InferSchemaInput, InferSchemaOutput, ORPCErrorConstructorMap } from '@orpc/contract'
import type { AnyRouter, ProcedureConfig } from '@orpc/server'
import type { FetchHandler } from '@orpc/server/fetch'
import type { Promisable } from '@orpc/shared'
import type { HttpHandler, HttpResponseResolver } from 'msw'
import { getDynamicPathParams, getOpenAPIMeta } from '@orpc/openapi'
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
 * Options for creating MSW procedure utils.
 *
 * @see {@link https://orpc.dev/docs/integrations/msw | MSW Integration}
 */
export interface ProcedureUtilsOptions extends ProcedureConfig {
  /**
   * The URL prefix requests are matched against, joined with the procedure's
   * HTTP path to form the MSW path predicate. Supports MSW wildcards in the
   * origin portion, such as `*\/rpc`.
   *
   * @default ''
   */
  url?: string

  /**
   * How procedure URLs are matched: `'rpc'` matches the RPC paths, `'openapi'`
   * matches each procedure's route metadata. Keep it in sync with the
   * protocol the created `handler` speaks.
   *
   * @default 'rpc'
   */
  protocol?: 'rpc' | 'openapi'

  /**
   * Creates the fetch handler that serves each mock, using the same
   * configuration as your production handler, such as plugins.
   *
   * The router passed in contains only the procedure being mocked. Requests
   * the created handler does not match fall through to other MSW handlers.
   *
   * @see {@link https://orpc.dev/docs/integrations/msw#advanced-configuration | MSW Integration - Advanced Configuration}
   */
  handler: (router: AnyRouter) => Pick<FetchHandler<ProcedureUtilsResolverInfo>, 'handle'>
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
 * responses go through the real RPC or OpenAPI runtime, so serialization,
 * validation, and error envelopes always match the production handler.
 *
 * @see {@link https://orpc.dev/docs/integrations/msw | MSW Integration}
 */
export class ProcedureUtils<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
> {
  private readonly urlPattern: string

  /**
   * Matches the procedure's HTTP path (with resolved path parameters) at the
   * end of a pathname, capturing the leading prefix. `undefined` when the
   * HTTP path is `/`, where the whole pathname is the prefix.
   */
  private readonly prefixRegExp: RegExp | undefined

  constructor(
    private readonly contract: AnyProcedureContract,
    private readonly path: readonly string[],
    private readonly options: ProcedureUtilsOptions,
  ) {
    const url = (this.options.url ?? '').replace(/\/+$/, '')
    const httpPath = this.resolveHttpPath()
    const dynamicParams = this.options.protocol === 'openapi'
      ? getDynamicPathParams(httpPath) ?? []
      : []

    let mswPath: string = httpPath
    let prefixSource = escapeRegExp(httpPath)

    for (let i = dynamicParams.length - 1; i >= 0; i--) {
      const param = dynamicParams[i]!
      const replace = (target: string, replacement: string, escaped: boolean) => {
        const start = escaped ? escapeRegExp(httpPath.slice(0, param.startIndex)).length : param.startIndex
        const length = escaped ? escapeRegExp(param.segment).length : param.segment.length
        return target.slice(0, start) + replacement + target.slice(start + length)
      }

      mswPath = replace(mswPath, param.allowsSlash ? '*' : `:${param.parameterName}`, false)
      prefixSource = replace(prefixSource, param.allowsSlash ? '.+' : '[^/]+', true)
    }

    this.urlPattern = httpPath === '/' ? (url || '/') : `${url}${mswPath}`
    this.prefixRegExp = httpPath === '/' ? undefined : new RegExp(`^(.*?)${prefixSource}$`)
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

    const router = this.path.reduceRight<AnyRouter>(
      (acc, segment) => ({ [segment]: acc }),
      procedure,
    )

    const fetchHandler = this.options.handler(router)

    return http.all(this.urlPattern, async (info) => {
      /**
       * The fetch handler consumes the request body, so hand it a clone
       * and keep the original readable for the mock handler.
       */
      const { matched, response } = await fetchHandler.handle(info.request.clone(), {
        prefix: this.resolveHttpPathPrefix(info.request),
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
    return http.all(this.urlPattern, () => new Promise<never>(() => {}))
  }

  /**
   * Creates an MSW request handler that performs matching requests against
   * the real server as-is, useful to exempt a procedure from mocking.
   *
   * @see {@link https://orpc.dev/docs/integrations/msw#passthrough | MSW Integration - Passthrough}
   */
  passthrough(): HttpHandler {
    return http.all(this.urlPattern, () => passthrough())
  }

  /**
   * Resolves the HTTP path the corresponding handler would serve this
   * procedure at, without any prefix.
   */
  private resolveHttpPath(): `/${string}` {
    if (this.options.protocol === 'openapi') {
      const meta = getOpenAPIMeta(this.contract)
      const httpPath = meta?.path ?? pathToHttpPath(this.path)

      return meta?.prefix ? mergeHttpPath(meta.prefix, httpPath) : httpPath
    }

    return pathToHttpPath(this.path)
  }

  /**
   * The fetch handlers match procedures by pathname, so derive the prefix from
   * the actual request instead of `url`, which may contain MSW wildcards.
   */
  private resolveHttpPathPrefix(request: Request): `/${string}` | undefined {
    let pathname = new URL(request.url).pathname as `/${string}`

    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = `/${pathname.replace(/\/+$/, '').slice(1)}`
    }

    if (this.prefixRegExp === undefined) {
      return pathname
    }

    const prefix = pathname.match(this.prefixRegExp)?.[1]

    return prefix ? prefix as `/${string}` : undefined
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`)
}
