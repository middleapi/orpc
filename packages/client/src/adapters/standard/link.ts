import type { Interceptor } from '@orpc/shared'
import type { StandardLazyResponse, StandardRequest } from '@standardserver/core'
import type { ClientContext, ClientLink, ClientOptions } from '../../types'
import type { StandardLinkCodec } from './codec'
import type { StandardLinkPlugin } from './plugin'
import type { StandardLinkTransport } from './transport'
import { getOpenTelemetryConfig, intercept, isAsyncIteratorObject, ORPC_NAME, override, runWithSpan, traceAsyncIterator } from '@orpc/shared'
import { CompositeStandardLinkPlugin } from './plugin'

export interface StandardLinkInterceptorOptions<T extends ClientContext> extends ClientOptions<T> {
  path: string[]
  input: unknown
}
export type StandardLinkInterceptor<T extends ClientContext> = Interceptor<StandardLinkInterceptorOptions<T>, Promise<unknown>>

export interface StandardLinkTransportInterceptorOptions<T extends ClientContext> extends ClientOptions<T> {
  path: string[]
  request: StandardRequest
}
export type StandardLinkTransportInterceptor<T extends ClientContext> = Interceptor<StandardLinkTransportInterceptorOptions<T>, Promise<StandardLazyResponse>>

export interface StandardLinkOptions<T extends ClientContext> {
  /**
   * Interceptors that execute around the entire call, including transport and codec.
   * Useful for error handling, logging, metrics, ...
   */
  interceptors?: StandardLinkInterceptor<T>[]

  /**
   * Interceptors that execute around the transport layer, after encoding and before decoding.
   * Useful for modifying the request or response, adding transport-level logging, ...
   */
  transportInterceptors?: StandardLinkTransportInterceptor<T>[]

  plugins?: StandardLinkPlugin<T>[]
}

export class StandardLink<T extends ClientContext> implements ClientLink<T> {
  private readonly interceptors: StandardLinkOptions<T>['interceptors']
  private readonly transportInterceptors: StandardLinkOptions<T>['transportInterceptors']

  constructor(
    private readonly codec: StandardLinkCodec<T>,
    private readonly transport: StandardLinkTransport<T>,
    options: StandardLinkOptions<T> = {},
  ) {
    options = new CompositeStandardLinkPlugin(options.plugins).init(options)

    this.interceptors = options.interceptors
    this.transportInterceptors = options.transportInterceptors
  }

  /**
   * @throws ORPCError, transport-level errors (network failures, timeouts, etc.)
   */
  call(path: string[], input: unknown, options: ClientOptions<T>): Promise<unknown> {
    return runWithSpan(`${ORPC_NAME}.${path.join('/')}`, (span) => {
      /**
       * [Semantic conventions for RPC spans](https://opentelemetry.io/docs/specs/semconv/rpc/rpc-spans/)
       */
      span?.setAttribute('rpc.system', ORPC_NAME)
      span?.setAttribute('rpc.method', path.join('.'))

      if (isAsyncIteratorObject(input)) {
        /**
         * @warning
         * Remember use `override` for event iterator to remain other special properties
         */
        input = override(input, traceAsyncIterator('consume_event_iterator_input', input))
      }

      return intercept(this.interceptors, { ...options, path, input }, async ({ path, input, ...options }) => {
        /**
         * In browsers, the OpenTelemetry context manager may not work reliably with async functions,
         * so we should manually manage the context here.
         */
        const otel = getOpenTelemetryConfig()
        let activeContext: ReturnType<Exclude<typeof otel, undefined>['context']['active']> | undefined
        const activeSpan = otel?.trace.getActiveSpan() ?? span
        if (activeSpan && otel) {
          activeContext = otel.trace.setSpan(otel.context.active(), activeSpan)
        }

        let request = await runWithSpan(
          { name: 'encode_input', context: activeContext },
          () => this.codec.encodeInput(input, path, options),
        )

        if (activeContext && otel?.propagation) {
          const headers = { ...request.headers }
          otel.propagation.inject(activeContext, headers)
          request = { ...request, headers }
        }

        const response = await intercept(
          this.transportInterceptors,
          { ...options, path, request },
          ({ path, request, ...options }) => {
            /**
             * In browsers, the OpenTelemetry context manager may not work reliably with async functions,
             * so we should manually manage the context here.
             */
            let activeTransportContext: ReturnType<Exclude<typeof otel, undefined>['context']['active']> | undefined
            const activeTransportSpan = otel?.trace.getActiveSpan() ?? activeSpan
            if (activeTransportSpan && otel) {
              activeTransportContext = otel.trace.setSpan(otel.context.active(), activeTransportSpan)
            }

            return runWithSpan(
              { name: 'send_request', context: activeTransportContext },
              () => this.transport.send(request, path, options),
            )
          },
        )

        const decodedResult = await runWithSpan(
          { name: 'decode_response', context: activeContext },
          () => this.codec.decodeResponse(response, path, options),
        )

        if (decodedResult.kind === 'error') {
          throw decodedResult.error
        }

        const output = decodedResult.output

        if (isAsyncIteratorObject(output)) {
          /**
           * Do not use otelContext here, as it is a lazy span.
           *
           * @warning
           * Remember use `override` for event iterator to remain other special properties
           */
          return override(output, traceAsyncIterator('consume_event_iterator_output', output))
        }

        return output
      })
    })
  }
}
