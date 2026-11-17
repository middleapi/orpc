import type { Interceptor, Tracer, TracingSpan } from '@orpc/shared'
import {
  getTracer,
  intercept,
  isAsyncIteratorObject,
  ORPC_NAME,
  override,
  runWithSpan,
  traceAsyncIterator,
  traceReadableStream,
} from '@orpc/shared'
import type { StandardLazyResponse, StandardRequest } from '@standard-server/core'

import type { ClientContext, ClientLink, ClientOptions } from '../../types'
import type { StandardLinkCodec } from './codec'
import type { StandardLinkPlugin } from './plugin'
import { CompositeStandardLinkPlugin } from './plugin'
import type { StandardLinkTransport } from './transport'

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
    const tracer = getTracer()

    if (!tracer) {
      return this.callWithInterceptors(path, input, options, undefined, undefined)
    }

    return runWithSpan(`${ORPC_NAME}.${path.join('/')}`, (span) => {
      /**
       * [Semantic conventions for RPC spans](https://opentelemetry.io/docs/specs/semconv/rpc/rpc-spans/)
       */
      span?.setAttribute('rpc.system', ORPC_NAME)
      span?.setAttribute('rpc.method', path.join('.'))

      if (isAsyncIteratorObject(input)) {
        /**
         * @warning
         * Remember use `override` for AsyncIteratorObject to remain other special properties
         */
        input = override(input, traceAsyncIterator('consume_async_iterator_object_input', input))
      } else if (input instanceof ReadableStream) {
        /**
         * @warning
         * Remember use `override` for ReadableStream to remain other special properties
         */
        input = override(input, traceReadableStream('consume_octet_stream_input', input))
      }

      return this.callWithInterceptors(path, input, options, tracer, span)
    })
  }

  private callWithInterceptors(
    path: string[],
    input: unknown,
    options: ClientOptions<T>,
    tracer: Tracer | undefined,
    span: TracingSpan | undefined,
  ): Promise<unknown> {
    if (!this.interceptors?.length) {
      return this.execute(path, input, options, tracer, span)
    }

    return tryPromise(() =>
      intercept(this.interceptors, { ...options, path, input }, ({ path, input, ...options }) =>
        this.execute(path, input, options, tracer, span),
      ),
    )
  }

  private async execute(
    path: string[],
    input: unknown,
    options: ClientOptions<T>,
    tracer: Tracer | undefined,
    span: TracingSpan | undefined,
  ): Promise<unknown> {
    /**
     * In browsers, the OpenTelemetry context manager may not work reliably with async functions,
     * so we should manually pass the parent span here.
     */
    const activeSpan = tracer?.getActiveSpan() ?? span

    let request = await (tracer
      ? runWithSpan({ name: 'encode_input', parent: activeSpan }, () =>
          this.codec.encodeInput(input, path, options),
        )
      : this.codec.encodeInput(input, path, options))

    if (activeSpan && tracer?.inject) {
      const headers = { ...request.headers }
      tracer.inject(activeSpan, headers)
      request = { ...request, headers }
    }

    const response = await (this.transportInterceptors?.length
      ? intercept(
          this.transportInterceptors,
          { ...options, path, request },
          ({ path, request, ...options }) =>
            tryPromise(() => this.send(request, path, options, tracer, activeSpan)),
        )
      : this.send(request, path, options, tracer, activeSpan))

    const decodedResult = await (tracer
      ? runWithSpan({ name: 'decode_response', parent: activeSpan }, () =>
          this.codec.decodeResponse(response, path, options),
        )
      : this.codec.decodeResponse(response, path, options))

    if (decodedResult.kind === 'error') {
      throw decodedResult.error
    }

    const output = decodedResult.output

    if (tracer && isAsyncIteratorObject(output)) {
      /**
       * Do not pass the active span as parent here, as it is a lazy span.
       *
       * @warning
       * Remember use `override` for AsyncIteratorObject to remain other special properties
       */
      return override(output, traceAsyncIterator('consume_async_iterator_object_output', output))
    } else if (tracer && output instanceof ReadableStream) {
      /**
       * @warning
       * Remember use `override` for ReadableStream to remain other special properties
       */
      return override(output, traceReadableStream('consume_octet_stream_output', output))
    }

    return output
  }

  private send(
    request: StandardRequest,
    path: string[],
    options: ClientOptions<T>,
    tracer: Tracer | undefined,
    parent: TracingSpan | undefined,
  ): Promise<StandardLazyResponse> {
    if (!tracer) {
      return this.transport.send(request, path, options)
    }

    /**
     * In browsers, the OpenTelemetry context manager may not work reliably with async functions,
     * so we should manually pass the parent span here.
     */
    return runWithSpan({ name: 'send_request', parent: tracer.getActiveSpan() ?? parent }, () =>
      this.transport.send(request, path, options),
    )
  }
}

function tryPromise<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return Promise.resolve(fn())
  } catch (error) {
    return Promise.reject(error)
  }
}
