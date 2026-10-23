import type { AnyORPCError } from '@orpc/client'
import type { Context } from '@orpc/server'
import type { StandardHandlerHandleResult, StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor, StandardHandlerRoutingInterceptorOptions } from '@orpc/server/standard'
import type { Promisable, Value } from '@orpc/shared'
import type { StandardHeaders } from '@standard-server/core'
import type { JsonRpcId, JsonRpcResponse } from '../../json-rpc'
import type { JsonRpcCallRequest } from './call'
import type { OpenRPCHandlerCodecOptions } from './openrpc-handler-codec'
import type { EncodedJsonRpcError, JsonRpcProtocolErrorCode } from './utils'
import { ORPCError } from '@orpc/client'
import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { matchesHttpPath, mergeHttpPath, pathToHttpPath, toArray, value } from '@orpc/shared'
import { DEFAULT_JSON_RPC_MAX_BATCH_SIZE, JSON_RPC_ERROR_CODES, JSON_RPC_VERSION } from '../../constants'
import { isJsonRpcErrorObject } from '../../json-rpc'
import { JSON_RPC_METHOD_SEPARATOR } from '../../utils'
import { getJsonRpcCall, JSON_RPC_CALL_SYMBOL } from './call'
import {
  cancelQuietly,
  completeJsonRpcResponse,
  createJsonRpcErrorEncoder,
  createJsonRpcProtocolErrorResponse,
  isJsonRpcMediaType,
  liftSubresponseHeaders,
  omitBodyHeaders,
  parseJsonRpcRequest,
} from './utils'

export interface OpenRPCEnvelopeHandlerPluginOptions<T extends Context>
  extends Pick<OpenRPCHandlerCodecOptions<T>, 'serializer' | 'errorCodeMap' | 'errorStatusMap' | 'customErrorEncoder'> {
  /**
   * The max number of request objects in a batch request. Larger batches are rejected with a `413`,
   * and `0` disables batch requests.
   *
   * @default DEFAULT_JSON_RPC_MAX_BATCH_SIZE (100)
   * @see {@link https://orpc.dev/docs/openrpc/handler#batch-requests | OpenRPC Handler - Batch Requests}
   */
  maxBatchSize?: Value<Promisable<number>, [options: StandardHandlerRoutingInterceptorOptions<T>]> | undefined

  /**
   * The HTTP status of a single (non-batch) response that carries a JSON-RPC error.
   *
   * - `'always-200'`: always `200`, which is what generic JSON-RPC clients expect.
   * - `'mapped'`: procedure errors use `errorStatusMap`, "Parse error" and "Invalid Request" use `400`,
   *   "Method not found" `404`, and "Internal error" `500`, so HTTP-level tooling (retries, caches, metrics) sees them.
   *
   * Batch responses always use `200`, and notifications `204`.
   *
   * @default 'always-200'
   * @see {@link https://orpc.dev/docs/openrpc/handler#http-status-codes | OpenRPC Handler - HTTP Status Codes}
   */
  errorResponseStatus?: 'always-200' | 'mapped' | undefined
}

/**
 * The HTTP status a protocol error gets with `errorResponseStatus: 'mapped'`.
 */
const MAPPED_PROTOCOL_ERROR_STATUS: Record<JsonRpcProtocolErrorCode, number> = {
  [JSON_RPC_ERROR_CODES.PARSE_ERROR]: 400,
  [JSON_RPC_ERROR_CODES.INVALID_REQUEST]: 400,
  [JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND]: 404,
  [JSON_RPC_ERROR_CODES.INVALID_PARAMS]: 400,
  [JSON_RPC_ERROR_CODES.INTERNAL_ERROR]: 500,
}

/**
 * The outcome of one JSON-RPC call (a single request or a batch item):
 * - `response`: `undefined` for notifications, which are never answered.
 * - `headers`: the sub-response headers, including the ones describing its body.
 * - `status`: the sub-response status, used for single calls with `errorResponseStatus: 'mapped'`.
 */
type JsonRpcCallResult = AnsweredJsonRpcCallResult | { response: undefined, headers: StandardHeaders, status?: undefined }

interface AnsweredJsonRpcCallResult {
  response: JsonRpcResponse
  headers: StandardHeaders
  status: number
}

/**
 * Reads the JSON-RPC 2.0 request objects (a single request or a batch) of an HTTP POST request
 * and runs each through the rest of the handler as its own call, then answers with the JSON-RPC response(s).
 * Other requests (non-POST, or another path than the prefix) pass through untouched.
 *
 * `OpenRPCHandler` adds it automatically. Use it with `OpenRPCHandlerCodec` to build a custom adapter.
 *
 * @remarks
 * **Note**: Plugins and interceptors placed inside it, such as tracing, logging, and rate limiting,
 * run once per JSON-RPC call and see a per-call sub-request, see `getJsonRpcCall`.
 * To see the raw HTTP request instead, order a plugin with `after: ['~openrpc']`.
 *
 * @see {@link https://orpc.dev/docs/openrpc/handler#custom-adapters | OpenRPC Handler - Custom Adapters}
 */
export class OpenRPCEnvelopeHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~openrpc'

  /**
   * Wrap the tracing interceptor so each JSON-RPC call gets its own span.
   */
  after = ['~tracing']

  /**
   * Body limits, decompression, and file spooling must apply to the real HTTP request body,
   * and CORS, response compression, and response headers to the real HTTP response.
   */
  before = ['~cors', '~request-limit', '~request-compression', '~response-compression', '~response-headers', '~tmp-file-upload']

  private readonly maxBatchSize: Exclude<OpenRPCEnvelopeHandlerPluginOptions<T>['maxBatchSize'], undefined>
  private readonly errorResponseStatus: Exclude<OpenRPCEnvelopeHandlerPluginOptions<T>['errorResponseStatus'], undefined>
  private readonly encodeJsonRpcError: (error: AnyORPCError) => EncodedJsonRpcError

  /**
   * @throws {TypeError} If an `errorCodeMap` value is not an integer.
   */
  constructor(options: OpenRPCEnvelopeHandlerPluginOptions<T> = {}) {
    this.encodeJsonRpcError = createJsonRpcErrorEncoder(
      { ...options, serializer: options.serializer ?? new OpenAPIJsonSerializer() },
      'OpenRPCEnvelopeHandlerPlugin',
    )

    this.maxBatchSize = options.maxBatchSize ?? DEFAULT_JSON_RPC_MAX_BATCH_SIZE
    this.errorResponseStatus = options.errorResponseStatus ?? 'always-200'
  }

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const routingInterceptor: StandardHandlerRoutingInterceptor<T> = async (interceptorOptions) => {
      const { request, prefix } = interceptorOptions

      if (
        request.method !== 'POST'
        || (prefix !== undefined && !matchesHttpPath(request.url, prefix))
        // a sub-request is never read as another envelope, even if the plugin is installed twice
        || getJsonRpcCall(request) !== undefined
      ) {
        return interceptorOptions.next()
      }

      /**
       * A JSON media type is required: none of them is CORS-safelisted, so a cross-site request
       * always needs a preflight, while a `text/plain` form or beacon would not (CSRF).
       */
      if (!isJsonRpcMediaType(request.headers['content-type'])) {
        return this.reject(new ORPCError('UNSUPPORTED_MEDIA_TYPE', {
          message: 'JSON-RPC requests must use Content-Type: application/json',
        }))
      }

      let payload: unknown

      try {
        // the explicit hint parses `application/json-rpc` too, which the content type alone would not
        payload = await request.resolveBody('json')
      }
      catch (error) {
        // errors of outer plugins, such as PAYLOAD_TOO_LARGE from the request limit plugin
        if (error instanceof ORPCError) {
          return this.reject(error)
        }

        return this.answer(this.protocolError(null, JSON_RPC_ERROR_CODES.PARSE_ERROR))
      }

      if (payload === undefined) {
        return this.answer(this.protocolError(null, JSON_RPC_ERROR_CODES.PARSE_ERROR))
      }

      if (!Array.isArray(payload)) {
        return this.answer(await this.call(interceptorOptions, payload, false))
      }

      if (payload.length === 0) {
        // the specification answers an empty batch with a single response, not an array
        return this.answer(this.protocolError(null, JSON_RPC_ERROR_CODES.INVALID_REQUEST))
      }

      const maxBatchSize = await value(this.maxBatchSize, interceptorOptions)

      // written so a NaN limit rejects too
      if (!(payload.length <= maxBatchSize)) {
        return this.reject(new ORPCError('PAYLOAD_TOO_LARGE', {
          message: maxBatchSize > 0
            ? `Batch size exceeds the maximum of ${maxBatchSize}.`
            : 'Batch requests are not supported.',
        }))
      }

      // calls run concurrently, but the responses keep the request order
      const results = await Promise.all(payload.map(item => this.call(interceptorOptions, item, true)))
      const headers = liftSubresponseHeaders(results.map(result => result.headers))
      const responses = results.flatMap(result => result.response === undefined ? [] : [result.response])

      if (responses.length === 0) {
        // a batch of only notifications is answered with nothing at all, never an empty array
        return { matched: true, response: { status: 204, headers, body: undefined } }
      }

      return { matched: true, response: { status: 200, headers, body: responses } }
    }

    return {
      ...options,
      routingInterceptors: [
        routingInterceptor,
        ...toArray(options.routingInterceptors),
      ],
    }
  }

  /**
   * Runs one JSON-RPC call through the rest of the handler as a sub-request, which reads `params` as its body.
   * Notifications run to completion too, so runtimes cannot cut their work off once the response is sent.
   */
  private async call(
    options: Parameters<StandardHandlerRoutingInterceptor<T>>[0],
    item: unknown,
    batch: boolean,
  ): Promise<JsonRpcCallResult> {
    const parsed = parseJsonRpcRequest(item)

    // an invalid request object is answered even without an `id`, as the specification requires
    if (!parsed.valid) {
      return this.protocolError(parsed.id, JSON_RPC_ERROR_CODES.INVALID_REQUEST)
    }

    const { method, params, notification } = parsed
    const id = parsed.id ?? null
    const httpPath = pathToHttpPath(method.split(JSON_RPC_METHOD_SEPARATOR))

    const request: JsonRpcCallRequest = {
      method: 'POST',
      // only for logs and spans, the codec routes by the JSON-RPC call instead
      url: options.prefix !== undefined ? mergeHttpPath(options.prefix, httpPath) : httpPath,
      headers: {
        ...options.request.headers,
        // describes the HTTP body, not the params
        'content-length': undefined,
      },
      signal: options.request.signal,
      resolveBody: () => Promise.resolve(params),
      [JSON_RPC_CALL_SYMBOL]: { method, id: parsed.id, notification, batch },
    }

    let result: StandardHandlerHandleResult

    try {
      result = await options.next({ ...options, request })
    }
    catch (error) {
      // a single call rethrows, so the rethrow plugin and framework error handling keep working
      if (!batch) {
        throw error
      }

      /**
       * Errors should not occur at the routing interceptor level.
       * Reject the promise so it can be handled by the unhandledRejection handler
       * for global logging or error handling.
       */
      Promise.reject(error)

      return notification
        ? { response: undefined, headers: {} }
        : this.protocolError(id, JSON_RPC_ERROR_CODES.INTERNAL_ERROR)
    }

    if (!result.matched) {
      return notification
        ? { response: undefined, headers: {} }
        : this.protocolError(id, JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND)
    }

    const { status, headers, body } = result.response

    if (notification) {
      await cancelQuietly(body)
      return { response: undefined, headers }
    }

    const response = completeJsonRpcResponse(body, id)

    // only reachable through a custom error encoder or an interceptor that replaced the body
    if (response === undefined) {
      await cancelQuietly(body)
      return { ...this.protocolError(id, JSON_RPC_ERROR_CODES.INTERNAL_ERROR), headers }
    }

    return { response, headers, status }
  }

  /**
   * A protocol error with the canonical message and no `data`.
   */
  private protocolError(id: JsonRpcId, code: JsonRpcProtocolErrorCode): AnsweredJsonRpcCallResult {
    return {
      response: createJsonRpcProtocolErrorResponse(id, code),
      headers: {},
      status: MAPPED_PROTOCOL_ERROR_STATUS[code],
    }
  }

  /**
   * Answers a single (non-batch) request: `204` for a notification, otherwise its JSON-RPC response.
   */
  private answer({ response, headers, status }: JsonRpcCallResult): StandardHandlerHandleResult {
    return {
      matched: true,
      response: response === undefined
        ? { status: 204, headers: omitBodyHeaders(headers), body: undefined }
        : { status: this.errorResponseStatus === 'mapped' ? status : 200, headers: omitBodyHeaders(headers), body: response },
    }
  }

  /**
   * Rejects the whole HTTP request at the transport level (wrong content type, body too large, ...)
   * with the status of the error code, whatever `errorResponseStatus` is.
   */
  private reject(error: AnyORPCError): StandardHandlerHandleResult {
    const encoded = this.encodeJsonRpcError(error)

    // a custom error encoder can return an invalid error object
    const { response, status } = isJsonRpcErrorObject(encoded.error)
      ? { response: { jsonrpc: JSON_RPC_VERSION, id: null, error: encoded.error }, status: encoded.status }
      : this.protocolError(null, JSON_RPC_ERROR_CODES.INTERNAL_ERROR)

    return { matched: true, response: { status, headers: {}, body: response } }
  }
}
