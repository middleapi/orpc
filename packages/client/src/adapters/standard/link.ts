import type { Interceptor } from '@orpc/shared'
import { getTracer, intercept, ORPC_NAME, runWithSpan, traceConsumption } from '@orpc/shared'
import type { StandardLazyResponse, StandardRequest } from '@standard-server/core'

import type { ClientContext, ClientLink, ClientOptions } from '../../types.ts'
import type { StandardLinkCodec } from './codec.ts'
import type { StandardLinkPlugin } from './plugin.ts'
import { CompositeStandardLinkPlugin } from './plugin.ts'
import type { StandardLinkTransport } from './transport.ts'

export interface StandardLinkInterceptorOptions<T extends ClientContext> extends ClientOptions<T> {
  path: string[]
  input: unknown
}
export type StandardLinkInterceptor<T extends ClientContext> = Interceptor<
  StandardLinkInterceptorOptions<T>,
  Promise<unknown>
>

export interface StandardLinkTransportInterceptorOptions<
  T extends ClientContext,
> extends ClientOptions<T> {
  path: string[]
  request: StandardRequest
}
export type StandardLinkTransportInterceptor<T extends ClientContext> = Interceptor<
  StandardLinkTransportInterceptorOptions<T>,
  Promise<StandardLazyResponse>
>

export interface StandardLinkOptions<T extends ClientContext> {
  /**
   * Interceptors that execute around the entire call, including transport and codec.
   * Useful for error handling, logging, metrics, ...
   */
  interceptors?: StandardLinkInterceptor<T>[] | undefined

  /**
   * Interceptors that execute around the transport layer, after encoding and before decoding.
   * Useful for modifying the request or response, adding transport-level logging, ...
   */
  transportInterceptors?: StandardLinkTransportInterceptor<T>[] | undefined

  plugins?: StandardLinkPlugin<T>[] | undefined
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
   * @throws ORPCError, MalformedResponseError, transport-level errors (network failures, timeouts, etc.)
   */
  call(path: string[], input: unknown, options: ClientOptions<T>): Promise<unknown> {
    return runWithSpan(`${ORPC_NAME}.${path.join('/')}`, (span) => {
      /**
       * [Semantic conventions for RPC spans](https://opentelemetry.io/docs/specs/semconv/rpc/rpc-spans/)
       */
      span?.setAttribute('rpc.system', ORPC_NAME)
      span?.setAttribute('rpc.method', path.join('.'))

      input = traceConsumption(input, 'input')

      return intercept(
        this.interceptors,
        { ...options, path, input },
        async ({ path, input, ...options }) => {
          /**
           * In browsers, the OpenTelemetry context manager may not work reliably with async functions,
           * so we should manually pass the parent span here.
           */
          const tracer = getTracer()
          const activeSpan = tracer?.getActiveSpan() ?? span

          let request = await runWithSpan({ name: 'encode_input', parent: activeSpan }, () =>
            this.codec.encodeInput(input, path, options),
          )

          if (activeSpan && tracer?.inject) {
            const headers = { ...request.headers }
            tracer.inject(activeSpan, headers)
            request = { ...request, headers }
          }

          const response = await intercept(
            this.transportInterceptors,
            { ...options, path, request },
            ({ path, request, ...options }) => {
              /**
               * In browsers, the OpenTelemetry context manager may not work reliably with async functions,
               * so we should manually pass the parent span here.
               */
              const activeTransportSpan = tracer?.getActiveSpan() ?? activeSpan

              return runWithSpan({ name: 'send_request', parent: activeTransportSpan }, () =>
                this.transport.send(request, path, options),
              )
            },
          )

          const decodedResult = await runWithSpan(
            { name: 'decode_response', parent: activeSpan },
            () => this.codec.decodeResponse(response, path, options),
          )

          if (decodedResult.kind === 'error') {
            throw decodedResult.error
          }

          /**
           * Do not pass the active span as parent here, as it is a lazy span.
           */
          return traceConsumption(decodedResult.output, 'output')
        },
      )
    })
  }
}
