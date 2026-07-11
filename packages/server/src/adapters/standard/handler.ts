import type { ErrorMap, Schema } from '@orpc/contract'
import type { Interceptor } from '@orpc/shared'
import type { StandardLazyRequest, StandardResponse } from '@standardserver/core'
import type { Context } from '../../context'
import type { ProcedureClientInterceptor } from '../../procedure-client'
import type { StandardHandlerCodec, StandardHandlerCodecResolvedProcedure } from './codec'
import type { StandardHandlerPlugin } from './plugin'
import { ORPCError, toORPCError } from '@orpc/client'
import { getOpenTelemetryConfig, intercept, isAsyncIteratorObject, matchesHttpPathPrefix, ORPC_NAME, override, recordSpanError, runWithSpan, toArray, traceAsyncIterator } from '@orpc/shared'
import { flattenStandardHeader } from '@standardserver/core'
import { createProcedureClient } from '../../procedure-client'
import { CompositeStandardHandlerPlugin } from './plugin'

export interface StandardHandlerHandleOptions<T extends Context> {
  prefix?: `/${string}` | undefined
  context: T
}

export type StandardHandlerHandleResult = { matched: true, response: StandardResponse } | { matched: false, response?: undefined }

export interface StandardHandlerInterceptorOptions<T extends Context> extends StandardHandlerCodecResolvedProcedure, StandardHandlerHandleOptions<T> {
  request: StandardLazyRequest
}
export type StandardHandlerInterceptor<T extends Context> = Interceptor<StandardHandlerInterceptorOptions<T>, Promise<StandardResponse>>

export interface StandardHandlerRoutingInterceptorOptions<T extends Context> extends StandardHandlerHandleOptions<T> {
  request: StandardLazyRequest
}
export type StandardHandlerRoutingInterceptor<T extends Context> = Interceptor<StandardHandlerRoutingInterceptorOptions<T>, Promise<StandardHandlerHandleResult>>

export interface StandardHandlerOptions<TContext extends Context> {
  /**
   * Fired on every request before routing, useful when you want
   * to intercept all requests regardless of whether they match a procedure or not.
   *
   * @examples
   * - batch plugins - separate one request into multiple and call multiple next
   * - openapi spec plugin - to intercept a request and early response
   */
  routingInterceptors?: StandardHandlerRoutingInterceptor<TContext>[]

  /**
   * interceptor run after routing and before error handler,
   * useful for error handling, logging, metrics, etc.
   */
  interceptors?: StandardHandlerInterceptor<TContext>[]

  /**
   *
   * ClientInterceptor equivalent with createRouterClient.interceptors / createProcedure.interceptors
   * useful for error handling, logging, metrics, etc. (not counting encoding/decoding)
   */
  clientInterceptors?: ProcedureClientInterceptor<TContext, Schema<unknown>, ErrorMap, any>[]

  plugins?: StandardHandlerPlugin<TContext>[]
}

export class StandardHandler<T extends Context> {
  private readonly routingInterceptors: StandardHandlerOptions<T>['routingInterceptors']
  private readonly interceptors: StandardHandlerOptions<T>['interceptors']
  private readonly clientInterceptors: StandardHandlerOptions<T>['clientInterceptors']

  constructor(
    private readonly codec: StandardHandlerCodec<T>,
    options: StandardHandlerOptions<T>,
  ) {
    options = new CompositeStandardHandlerPlugin([
      new OtelHandlerPlugin(),
      ...toArray(options.plugins),
    ]).init(options)

    this.routingInterceptors = options.routingInterceptors
    this.interceptors = options.interceptors
    this.clientInterceptors = options.clientInterceptors
  }

  async handle(request: StandardLazyRequest, { context, prefix }: StandardHandlerHandleOptions<T>): Promise<StandardHandlerHandleResult> {
    if (prefix && !matchesHttpPathPrefix(request.url, prefix)) {
      return { matched: false, response: undefined }
    }

    return intercept(
      this.routingInterceptors,
      { context, prefix, request },
      async ({ context, prefix, request }) => {
        const span = getOpenTelemetryConfig()?.trace.getActiveSpan()

        let step: 'decode_input' | 'call_procedure' | undefined

        const matchedOrNot = await runWithSpan('find_procedure', () => this.codec.resolveProcedure(request, { context, prefix }))

        if (!matchedOrNot) {
          /**
           * [Semantic conventions for HTTP spans](https://opentelemetry.io/docs/specs/semconv/http/http-spans/)
           */
          span?.updateName(`${ORPC_NAME}_no_match`)
          span?.setAttribute('http.request.method', request.method)
          span?.setAttribute('url.path', request.url)

          return { matched: false }
        }

        const { path, procedure, decodeInput } = matchedOrNot

        /**
         * [Semantic conventions for RPC spans](https://opentelemetry.io/docs/specs/semconv/rpc/rpc-spans/)
         */
        span?.updateName(`${ORPC_NAME}.${path.join('/')}`)
        span?.setAttribute('rpc.system', ORPC_NAME)
        span?.setAttribute('rpc.method', path.join('.'))

        try {
          const response = await intercept(
            this.interceptors,
            { context, prefix, request, path, procedure, decodeInput },

            async ({ context, prefix, request, path, procedure, decodeInput }) => {
              step = 'decode_input'
              let input = await runWithSpan('decode_input', decodeInput)
              step = undefined

              if (isAsyncIteratorObject(input)) {
                /**
                 * @warning
                 * Remember use `override` for AsyncIteratorObject to remain other special properties
                 */
                input = override(input, traceAsyncIterator('consume_async_iterator_object_input', input))
              }

              const client = createProcedureClient(procedure, {
                context,
                path,
                interceptors: this.clientInterceptors,
              })

              /**
               * No need to use `runWithSpan` here, because the client already has its own span.
               */
              step = 'call_procedure'
              const output = await client(input, {
                signal: request.signal,
                lastEventId: flattenStandardHeader(request.headers['last-event-id']),
              })
              step = undefined

              const response = await this.codec.encodeOutput(output, procedure, path, { context, prefix })

              return response
            },
          )

          return { matched: true, response }
        }
        catch (e) {
          /**
           * Only errors that happen outside of the `call_procedure` step should be set as an error.
           * Because a business logic error should not be considered as a protocol-level error.
           */
          if (step !== 'call_procedure') {
            recordSpanError(span, e)
          }

          const error = step === 'decode_input' && !(e instanceof ORPCError)
            ? new ORPCError('BAD_REQUEST', {
                message: `Malformed request. Ensure the request body is properly formatted and the 'Content-Type' header is set correctly.`,
                cause: e,
              })
            : toORPCError(e)

          const response = await this.codec.encodeError(error, procedure, path, { context, prefix })

          return { matched: true, response }
        }
      },
    )
  }
}

export class OtelHandlerPlugin implements StandardHandlerPlugin<any> {
  name = '~opentelemetry'

  init(options: StandardHandlerOptions<any>): StandardHandlerOptions<any> {
    return {
      ...options,
      routingInterceptors: [
        // Should be placed before user-provided interceptors to help them access the current active context.
        async ({ next, request }) => {
          const otelConfig = getOpenTelemetryConfig()

          let propagationContext
          if (otelConfig?.propagation) {
            propagationContext = otelConfig.propagation.extract(otelConfig.context.active(), request.headers)
          }

          return runWithSpan(
            { name: `${request.method} ${request.url}`, context: propagationContext },
            () => next(),
          )
        },
        ...toArray(options.routingInterceptors),
      ],
    }
  }
}
