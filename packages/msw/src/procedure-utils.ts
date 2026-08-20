import type { AnyORPCError, ORPCErrorCode } from '@orpc/client'
import type { AnyProcedureContract, AnySchema, ErrorMap, InferSchemaInput, InferSchemaOutput, ORPCErrorConstructorMap } from '@orpc/contract'
import type { AnyRouter, ProcedureConfig } from '@orpc/server'
import type { RPCHandlerOptions } from '@orpc/server/fetch'
import type { Promisable } from '@orpc/shared'
import type { HttpHandler, HttpResponseResolver } from 'msw'
import { implement } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { pathToHttpPath } from '@orpc/shared'
import { http } from 'msw'

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
export interface ProcedureUtilsOptions extends RPCHandlerOptions<ProcedureUtilsResolverInfo>, ProcedureConfig {
  /**
   * The URL prefix requests are matched against, joined with the procedure path
   * to form the MSW path predicate. Supports MSW wildcards, such as `*\/rpc`.
   *
   * @default ''
   */
  baseUrl?: string
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
 * responses go through the real RPC runtime, so serialization, validation,
 * and error envelopes always match the production RPC handler.
 *
 * @see {@link https://orpc.dev/docs/integrations/msw | MSW Integration}
 */
export class ProcedureUtils<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
> {
  private readonly httpPath: `/${string}`
  private readonly urlPattern: string

  constructor(
    private readonly contract: AnyProcedureContract,
    private readonly path: readonly string[],
    private readonly options: ProcedureUtilsOptions,
  ) {
    this.httpPath = pathToHttpPath(this.path)
    const baseUrl = (this.options.baseUrl ?? '').replace(/\/+$/, '')
    this.urlPattern = this.httpPath === '/' ? (baseUrl || '/') : `${baseUrl}${this.httpPath}`
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

    const rpcHandler = new RPCHandler<ProcedureUtilsResolverInfo>(router as AnyRouter, this.options)

    return http.all(this.urlPattern, async (info) => {
      /**
       * The RPC handler consumes the request body, so hand it a clone
       * and keep the original readable for the mock handler.
       */
      const { matched, response } = await rpcHandler.handle(info.request.clone(), {
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
   * The RPC handler matches procedures by pathname, so derive the prefix from
   * the actual request instead of `baseUrl`, which may contain MSW wildcards.
   */
  private resolveHttpPathPrefix(request: Request): `/${string}` | undefined {
    let pathname = new URL(request.url).pathname as `/${string}`

    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = `/${pathname.replace(/\/+$/, '').slice(1)}`
    }

    if (this.httpPath === '/') {
      return pathname
    }

    if (pathname.endsWith(this.httpPath)) {
      const prefix = pathname.slice(0, pathname.length - this.httpPath.length)
      return prefix === '' ? undefined : prefix as `/${string}`
    }

    return undefined
  }
}
