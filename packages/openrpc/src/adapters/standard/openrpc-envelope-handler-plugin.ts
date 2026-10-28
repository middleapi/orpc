import type { AnyORPCError } from '@orpc/client'
import type { Context } from '@orpc/server'
import type { StandardHandlerHandleResult, StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor, StandardHandlerRoutingInterceptorOptions } from '@orpc/server/standard'
import type { Promisable, Value } from '@orpc/shared'
import type { StandardHeaders, StandardLazyRequest } from '@standard-server/core'
import type { JsonRpcId, JsonRpcResponse } from '../../json-rpc'
import type { OpenRPCHandlerCodecOptions } from './openrpc-handler-codec'
import type { JsonRpcCall } from './utils'
import { COMMON_ERROR_STATUS_MAP, ORPCError } from '@orpc/client'
import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { DEFAULT_ERROR_STATUS } from '@orpc/server'
import { getOwn, isPlainObject, matchesHttpPath, mergeHttpPath, pathToHttpPath, toArray, value } from '@orpc/shared'
import { mergeStandardHeaders } from '@standard-server/core'
import { DEFAULT_JSON_RPC_MAX_BATCH_SIZE, JSON_RPC_ERROR_CODES, JSON_RPC_VERSION } from '../../constants'
import { encodeJsonRpcError, hasJsonRpcResultOrError, isJsonRpcId } from '../../json-rpc'
import { getJsonRpcCall, isJsonRpcMediaType, JSON_RPC_CALL_SYMBOL } from './utils'

export interface OpenRPCEnvelopeHandlerPluginOptions<T extends Context>
  extends Pick<OpenRPCHandlerCodecOptions<T>, 'serializer' | 'errorCodeMap'> {
  /**
   * The max number of requests in a batch. Larger batches are rejected with `413`.
   *
   * @default DEFAULT_JSON_RPC_MAX_BATCH_SIZE (100)
   * @see {@link https://orpc.dev/docs/openrpc/handler#batch-requests-and-notifications | OpenRPC Handler - Batch Requests and Notifications}
   */
  maxBatchSize?: Value<Promisable<number>, [options: StandardHandlerRoutingInterceptorOptions<T>]> | undefined
}

const PROTOCOL_ERROR_MESSAGES = {
  [JSON_RPC_ERROR_CODES.PARSE_ERROR]: 'Parse error',
  [JSON_RPC_ERROR_CODES.INVALID_REQUEST]: 'Invalid Request',
  [JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND]: 'Method not found',
  [JSON_RPC_ERROR_CODES.INTERNAL_ERROR]: 'Internal error',
}

function protocolError(id: JsonRpcId, code: keyof typeof PROTOCOL_ERROR_MESSAGES): JsonRpcResponse {
  return { jsonrpc: JSON_RPC_VERSION, id, error: { code, message: PROTOCOL_ERROR_MESSAGES[code] } }
}

function reply(body: JsonRpcResponse | JsonRpcResponse[] | undefined, headers: StandardHeaders = {}): StandardHandlerHandleResult {
  return { matched: true, response: { status: body === undefined ? 204 : 200, headers, body } }
}

/**
 * Reads the JSON-RPC 2.0 requests (single or batch) of an HTTP POST request and runs each through
 * the rest of the handler as its own sub-request, then answers with the JSON-RPC response(s).
 * Other requests (not POST, or another path than the prefix) pass through untouched.
 *
 * `OpenRPCHandler` adds it automatically. Plugins and interceptors inside it, such as tracing,
 * see one sub-request per call, see `getJsonRpcCall`.
 */
export class OpenRPCEnvelopeHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~openrpc'

  /**
   * Wrap the tracing interceptor so each call gets its own span.
   */
  after = ['~tracing']

  /**
   * These must apply to the real HTTP request and response, not to each call.
   */
  before = ['~cors', '~request-limit', '~request-compression', '~response-compression', '~response-headers', '~tmp-file-upload']

  private readonly maxBatchSize: Exclude<OpenRPCEnvelopeHandlerPluginOptions<T>['maxBatchSize'], undefined>
  private readonly serializer: Exclude<OpenRPCEnvelopeHandlerPluginOptions<T>['serializer'], undefined>
  private readonly errorCodeMap: OpenRPCEnvelopeHandlerPluginOptions<T>['errorCodeMap']

  constructor(options: OpenRPCEnvelopeHandlerPluginOptions<T> = {}) {
    this.maxBatchSize = options.maxBatchSize ?? DEFAULT_JSON_RPC_MAX_BATCH_SIZE
    this.serializer = options.serializer ?? new OpenAPIJsonSerializer()
    this.errorCodeMap = options.errorCodeMap
  }

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const routingInterceptor: StandardHandlerRoutingInterceptor<T> = async (interceptorOptions) => {
      const { request, prefix } = interceptorOptions

      if (
        request.method !== 'POST'
        || (prefix !== undefined && !matchesHttpPath(request.url, prefix))
        || getJsonRpcCall(request) !== undefined
      ) {
        return interceptorOptions.next()
      }

      if (!isJsonRpcMediaType(request.headers['content-type'])) {
        return this.reject(new ORPCError('UNSUPPORTED_MEDIA_TYPE', { message: 'JSON-RPC requests must use Content-Type: application/json' }))
      }

      let payload: unknown

      try {
        payload = await request.resolveBody('json')
      }
      catch (error) {
        // errors of outer plugins, such as the request limit plugin
        if (error instanceof ORPCError) {
          return this.reject(error)
        }
      }

      if (payload === undefined) {
        return reply(protocolError(null, JSON_RPC_ERROR_CODES.PARSE_ERROR))
      }

      if (!Array.isArray(payload)) {
        const { response, headers } = await this.call(interceptorOptions, payload, false)
        return reply(response, headers)
      }

      if (payload.length === 0) {
        return reply(protocolError(null, JSON_RPC_ERROR_CODES.INVALID_REQUEST))
      }

      const maxBatchSize = await value(this.maxBatchSize, interceptorOptions)

      if (payload.length > maxBatchSize) {
        return this.reject(new ORPCError('PAYLOAD_TOO_LARGE', { message: `Batch size exceeds the maximum of ${maxBatchSize}.` }))
      }

      const results = await Promise.all(payload.map(item => this.call(interceptorOptions, item, true)))
      const responses = results.flatMap(({ response }) => response ? [response] : [])

      // a batch of only notifications is answered with nothing, never an empty array
      return reply(responses.length ? responses : undefined, results.reduce<StandardHeaders>((merged, { headers }) => mergeStandardHeaders(merged, headers), {}))
    }

    return {
      ...options,
      routingInterceptors: [routingInterceptor, ...toArray(options.routingInterceptors)],
    }
  }

  /**
   * Runs one call as a sub-request whose body is its `params`. Notifications run to completion too, but are never answered.
   */
  private async call(
    options: Parameters<StandardHandlerRoutingInterceptor<T>>[0],
    item: unknown,
    batch: boolean,
  ): Promise<{ response?: JsonRpcResponse, headers: StandardHeaders }> {
    const { jsonrpc, method, params, id: rawId } = isPlainObject(item)
      ? { jsonrpc: getOwn(item, 'jsonrpc'), method: getOwn(item, 'method'), params: getOwn(item, 'params'), id: getOwn(item, 'id') }
      : {} as Record<string, unknown>

    if (
      jsonrpc !== JSON_RPC_VERSION
      || typeof method !== 'string'
      || (rawId !== undefined && !isJsonRpcId(rawId))
      || (params !== undefined && params !== null && !Array.isArray(params) && !isPlainObject(params))
    ) {
      // answered even without an `id`, with the `id` when it is valid
      return { response: protocolError(isJsonRpcId(rawId) ? rawId : null, JSON_RPC_ERROR_CODES.INVALID_REQUEST), headers: {} }
    }

    const id = rawId as JsonRpcId | undefined
    const request: StandardLazyRequest & { [JSON_RPC_CALL_SYMBOL]: JsonRpcCall } = {
      method: 'POST',
      // only for logs and spans, the codec routes by the call
      url: mergeHttpPath(options.prefix ?? '/', pathToHttpPath(method.split('.'))),
      headers: { ...options.request.headers, 'content-length': undefined },
      signal: options.request.signal,
      resolveBody: async () => params ?? undefined,
      [JSON_RPC_CALL_SYMBOL]: { method, id },
    }

    let result: StandardHandlerHandleResult

    try {
      result = await options.next({ ...options, request })
    }
    catch (error) {
      if (!batch) {
        throw error
      }

      // like the batch plugin, report it as an unhandled rejection and answer the other calls
      Promise.reject(error)
      result = { matched: true, response: { status: 500, headers: {}, body: undefined } }
    }

    const headers = Object.fromEntries(Object.entries(result.response?.headers ?? {})
      .filter(([name]) => !name.startsWith('content-') && name !== 'standard-server'))

    if (id === undefined) {
      return { headers }
    }

    if (!result.matched) {
      return { response: protocolError(id, JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND), headers }
    }

    const body = result.response.body

    if (hasJsonRpcResultOrError(body)) {
      return {
        response: 'result' in body ? { jsonrpc: JSON_RPC_VERSION, id, result: body.result } : { jsonrpc: JSON_RPC_VERSION, id, error: body.error },
        headers,
      }
    }

    return { response: protocolError(id, JSON_RPC_ERROR_CODES.INTERNAL_ERROR), headers }
  }

  /**
   * Rejects the whole HTTP request (wrong content type, body or batch too large) with the status of the error.
   */
  private reject(error: AnyORPCError): StandardHandlerHandleResult {
    return {
      matched: true,
      response: {
        status: getOwn(COMMON_ERROR_STATUS_MAP, error.code) ?? DEFAULT_ERROR_STATUS,
        headers: {},
        body: { jsonrpc: JSON_RPC_VERSION, id: null, error: encodeJsonRpcError(error, this.serializer, this.errorCodeMap) },
      },
    }
  }
}
