import type { Interceptor } from '@orpc/shared'
import type { StandardHeaders, StandardLazyResponse, StandardRequest } from '@standard-server/core'
import type { ClientContext, ClientLink, ClientOptions } from '../../types'
import type { StandardLinkCodec } from './codec'
import type { StandardLinkPlugin } from './plugin'
import type { StandardLinkTransport } from './transport'
import { getTracer, intercept, isAsyncIteratorObject, ORPC_NAME, override, runWithSpan, traceAsyncIterator, traceReadableStream } from '@orpc/shared'
import { mergeStandardHeaders } from '@standard-server/core'
import { getRequestHeaders, getResponseHeaders, REQUEST_HEADERS_CONTEXT_SYMBOL, RESPONSE_HEADERS_CONTEXT_SYMBOL } from '../../headers'
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
    /**
     * Inject the request and response headers, so interceptors and plugins can access them.
     * The request headers are copied, so changes made during the call never reach the caller's object,
     * while the response headers fill the caller's object, so the caller can read them after the call.
     */
    const requestHeaders: StandardHeaders = { ...getRequestHeaders(options.context) }
    const responseHeaders: StandardHeaders = getResponseHeaders(options.context) ?? {}

    options = {
      ...options,
      context: {
        ...options.context,
        [REQUEST_HEADERS_CONTEXT_SYMBOL]: requestHeaders,
        [RESPONSE_HEADERS_CONTEXT_SYMBOL]: responseHeaders,
      },
    }

    return runWithSpan(`${ORPC_NAME}.${path.join('/')}`, (span) => {
      /**
       * [Semantic conventions for RPC spans](https://opentelemetry.io/docs/specs/semconv/rpc/rpc-spans/)
       */
      span?.setAttribute('rpc.system', ORPC_NAME)
      span?.setAttribute('rpc.method', path.join('.'))

      if (getTracer() && isAsyncIteratorObject(input)) {
        /**
         * @warning
         * Remember use `override` for AsyncIteratorObject to remain other special properties
         */
        input = override(input, traceAsyncIterator('consume_async_iterator_object_input', input))
      }

      else if (getTracer() && input instanceof ReadableStream) {
        /**
         * @warning
         * Remember use `override` for ReadableStream to remain other special properties
         */
        input = override(input, traceReadableStream('consume_octet_stream_input', input))
      }

      return intercept(this.interceptors, { ...options, path, input }, async ({ path, input, ...options }) => {
        /**
         * In browsers, the OpenTelemetry context manager may not work reliably with async functions,
         * so we should manually pass the parent span here.
         */
        const tracer = getTracer()
        const activeSpan = tracer?.getActiveSpan() ?? span

        let request = await runWithSpan(
          { name: 'encode_input', parent: activeSpan },
          () => this.codec.encodeInput(input, path, options),
        )

        // Leave the request as is when no header was set
        if (Object.keys(requestHeaders).length > 0) {
          request = { ...request, headers: mergeStandardHeaders(request.headers, requestHeaders) }
        }

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

            return runWithSpan(
              { name: 'send_request', parent: activeTransportSpan },
              () => this.transport.send(request, path, options),
            )
          },
        )

        // Keep only the headers of the latest response, such as the last attempt of a retry
        for (const name of Object.keys(responseHeaders)) {
          delete responseHeaders[name]
        }

        Object.assign(responseHeaders, response.headers)

        const decodedResult = await runWithSpan(
          { name: 'decode_response', parent: activeSpan },
          () => this.codec.decodeResponse(response, path, options),
        )

        if (decodedResult.kind === 'error') {
          throw decodedResult.error
        }

        const output = decodedResult.output

        if (getTracer() && isAsyncIteratorObject(output)) {
          /**
           * Do not pass the active span as parent here, as it is a lazy span.
           *
           * @warning
           * Remember use `override` for AsyncIteratorObject to remain other special properties
           */
          return override(output, traceAsyncIterator('consume_async_iterator_object_output', output))
        }

        else if (getTracer() && output instanceof ReadableStream) {
          /**
           * @warning
           * Remember use `override` for ReadableStream to remain other special properties
           */
          return override(output, traceReadableStream('consume_octet_stream_output', output))
        }

        return output
      })
    })
  }
}
