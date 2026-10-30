import type { AnyORPCError } from '@orpc/client'
import type { Context, Router } from '@orpc/server'
import type {
  StandardHandlerHandleOptions,
  StandardHandlerHandleResult,
  StandardHandlerOptions,
  StandardHandlerPlugin,
  StandardHandlerRoutingInterceptor,
  StandardHandlerRoutingInterceptorOptions,
} from '@orpc/server/standard'
import type { Promisable, Public, Value } from '@orpc/shared'
import type { StandardHeaders, StandardLazyRequest, StandardUrl } from '@standard-server/core'
import type { JsonRpcErrorObject, JsonRpcId, JsonRpcResponse } from '../../json-rpc'
import type { OpenRPCDocument } from '../../types'
import type { OpenRPCHandlerCodecOptions } from './openrpc-handler-codec'
import type { JsonRpcCall } from './utils'
import { COMMON_ERROR_STATUS_MAP, ORPCError } from '@orpc/client'
import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { DEFAULT_ERROR_STATUS } from '@orpc/server'
import { StandardHandler } from '@orpc/server/standard'
import { getOwn, intercept, isPlainObject, matchesHttpPath, matchesHttpPathPrefix, mergeHttpPath, pathToHttpPath, sortPlugins, toArray, value } from '@orpc/shared'
import { mergeStandardHeaders } from '@standard-server/core'
import { DEFAULT_JSON_RPC_MAX_BATCH_SIZE, JSON_RPC_ERROR_CODES, JSON_RPC_VERSION } from '../../constants'
import { encodeJsonRpcError, hasJsonRpcResultOrError, isJsonRpcId } from '../../json-rpc'
import { OpenRPCHandlerCodec } from './openrpc-handler-codec'
import { isJsonRpcMediaType, JSON_RPC_CALL_SYMBOL } from './utils'

export interface OpenRPCHandlerDiscoveryOptions<T extends Context> {
  /**
   * The document to serve, for example a memoized `() => generator.generate(router)`.
   * Throw an `ORPCError` to refuse it.
   */
  spec: Value<Promisable<OpenRPCDocument>, [options: StandardHandlerRoutingInterceptorOptions<T>]>

  /**
   * The path (relative to the prefix) at which to also serve the document over `GET`, or `false` to disable it.
   *
   * @default '/openrpc.json'
   */
  specPath?: StandardUrl | false | undefined
}

export interface StandardOpenRPCHandlerOptions<T extends Context> extends StandardHandlerOptions<T>, OpenRPCHandlerCodecOptions<T> {
  /**
   * The max number of requests in a batch. Larger batches are rejected with `413`.
   *
   * @default DEFAULT_JSON_RPC_MAX_BATCH_SIZE (100)
   * @see {@link https://orpc.dev/docs/openrpc/handler#batch-requests-and-notifications | OpenRPC Handler - Batch Requests and Notifications}
   */
  maxBatchSize?: Value<Promisable<number>, [options: StandardHandlerRoutingInterceptorOptions<T>]> | undefined

  /**
   * Answers the OpenRPC Service Discovery method `rpc.discover` with the document, and serves it over `GET`.
   *
   * @see {@link https://orpc.dev/docs/openrpc/specification#service-discovery | OpenRPC Specification - Service Discovery}
   */
  discovery?: OpenRPCHandlerDiscoveryOptions<T> | undefined
}

export interface StandardOpenRPCHandlerMessageOptions<T extends Context> extends StandardHandlerHandleOptions<T> {
  /**
   * Aborts the calls of the message, such as when its socket closes.
   */
  signal?: AbortSignal | undefined
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
 * The handler every `OpenRPCHandler` adapter is built on. It reads the JSON-RPC 2.0 requests (single or batch)
 * of an HTTP POST request, or of a WebSocket message, runs each call, and answers with the JSON-RPC response(s).
 *
 * Plugins hook in at two levels: `routingInterceptors` run once per HTTP request (or message), such as CORS
 * or the request limit, while each call runs through `StandardHandler` as its own sub-request, with its own
 * tracing span, `interceptors`, and `clientInterceptors`. Interceptors read the call with `getJsonRpcCall`.
 * `rpc.discover`, answered by the `discovery` option, only runs inside the routing interceptors.
 *
 * @see {@link https://orpc.dev/docs/openrpc/handler#interceptors | OpenRPC Handler - Interceptors}
 */
export class StandardOpenRPCHandler<T extends Context> extends StandardHandler<T> {
  private readonly requestInterceptors: StandardHandlerRoutingInterceptor<T>[] | undefined
  private readonly serializer: Public<OpenAPIJsonSerializer>
  private readonly errorCodeMap: StandardOpenRPCHandlerOptions<T>['errorCodeMap']
  private readonly maxBatchSize: Exclude<StandardOpenRPCHandlerOptions<T>['maxBatchSize'], undefined>
  private readonly discovery: StandardOpenRPCHandlerOptions<T>['discovery']

  constructor(router: Router<T>, options: NoInfer<StandardOpenRPCHandlerOptions<T>> = {}) {
    let initialized: StandardHandlerOptions<T> = options

    // core's per-call tracing plugin is not initialized here, but takes part in the sort, so plugins ordered around it keep their order
    for (const plugin of sortPlugins<StandardHandlerPlugin<T>>([...toArray(options.plugins), { name: '~tracing' }])) {
      initialized = plugin.init?.(initialized) ?? initialized
    }

    // the plugins are already initialized, the routing interceptors run in `.handle`
    super(new OpenRPCHandlerCodec(router, options), {
      interceptors: initialized.interceptors,
      clientInterceptors: initialized.clientInterceptors,
    })

    this.requestInterceptors = initialized.routingInterceptors
    this.serializer = options.serializer ?? new OpenAPIJsonSerializer()
    this.errorCodeMap = options.errorCodeMap
    this.maxBatchSize = options.maxBatchSize ?? DEFAULT_JSON_RPC_MAX_BATCH_SIZE
    this.discovery = options.discovery
  }

  /**
   * Answers a `POST` to the prefix itself (to any path without a prefix), and the `GET` of the discovery document.
   * Other requests are not matched.
   */
  override async handle(request: StandardLazyRequest, options: StandardHandlerHandleOptions<T>): Promise<StandardHandlerHandleResult> {
    const { prefix } = options

    if (prefix && !matchesHttpPathPrefix(request.url, prefix)) {
      return { matched: false }
    }

    const context = await value(options.context, request) as T

    return intercept(this.requestInterceptors, { context, prefix, request }, async (routed) => {
      const { request, prefix } = routed

      if (request.method === 'GET') {
        return this.serveSpec(routed)
      }

      if (request.method !== 'POST' || (prefix !== undefined && !matchesHttpPath(request.url, prefix))) {
        return { matched: false }
      }

      if (!isJsonRpcMediaType(request.headers['content-type'])) {
        return this.reject(new ORPCError('UNSUPPORTED_MEDIA_TYPE', { message: 'JSON-RPC requests must use Content-Type: application/json' }))
      }

      return this.dispatch(routed)
    })
  }

  /**
   * Answers a message that is already parsed (`undefined` when it was not valid JSON), such as one of a WebSocket.
   * Routing interceptors see a request whose body is the message.
   */
  async handleMessage(message: unknown, options: StandardOpenRPCHandlerMessageOptions<T>): Promise<StandardHandlerHandleResult> {
    const { prefix, signal } = options
    const request: StandardLazyRequest = { method: 'POST', url: prefix ?? '/', headers: {}, signal, resolveBody: async () => message }
    const context = await value(options.context, request) as T

    // a WebSocket client matches responses by `id`, so a refusal of the whole message answers each of its calls
    const refuse = (error: JsonRpcErrorObject) => this.answerEachCall(message, error)

    let dispatched = false

    const result = await intercept(this.requestInterceptors, { context, prefix, request }, (routed) => {
      dispatched = true
      return this.dispatch(routed, error => refuse(encodeJsonRpcError(error, this.serializer, this.errorCodeMap)))
    })

    if (dispatched) {
      return result
    }

    // a routing interceptor answered the message itself, such as an authentication guard
    if (!result.matched) {
      return refuse({ code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND, message: PROTOCOL_ERROR_MESSAGES[JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND] })
    }

    const { status, body } = result.response

    if (hasJsonRpcResultOrError(body) && 'error' in body) {
      return refuse(body.error)
    }

    const code = Object.keys(COMMON_ERROR_STATUS_MAP).find(code => getOwn(COMMON_ERROR_STATUS_MAP, code) === status) ?? 'INTERNAL_SERVER_ERROR'

    return refuse(encodeJsonRpcError(new ORPCError(code), this.serializer, this.errorCodeMap))
  }

  /**
   * Answers each call of a message with the same error. Notifications are never answered,
   * and a message without readable calls is answered with a `null` id.
   */
  private answerEachCall(message: unknown, error: JsonRpcErrorObject): StandardHandlerHandleResult {
    const answer = (item: unknown): JsonRpcResponse | undefined => {
      const id = isPlainObject(item) ? getOwn(item, 'id') : null
      return id === undefined ? undefined : { jsonrpc: JSON_RPC_VERSION, id: isJsonRpcId(id) ? id : null, error }
    }

    if (!Array.isArray(message) || message.length === 0) {
      return reply(answer(Array.isArray(message) ? null : message))
    }

    const responses = message.flatMap(item => answer(item) ?? [])

    return reply(responses.length ? responses : undefined)
  }

  private async dispatch(
    options: StandardHandlerRoutingInterceptorOptions<T>,
    reject = (error: AnyORPCError) => this.reject(error),
  ): Promise<StandardHandlerHandleResult> {
    let payload: unknown

    try {
      payload = await options.request.resolveBody('json')
    }
    catch (error) {
      // errors of plugins, such as the request limit plugin
      if (error instanceof ORPCError) {
        return reject(error)
      }
    }

    if (payload === undefined) {
      return reply(protocolError(null, JSON_RPC_ERROR_CODES.PARSE_ERROR))
    }

    if (!Array.isArray(payload)) {
      const { response, headers } = await this.call(options, payload, false)
      return reply(response, headers)
    }

    if (payload.length === 0) {
      return reply(protocolError(null, JSON_RPC_ERROR_CODES.INVALID_REQUEST))
    }

    const maxBatchSize = await value(this.maxBatchSize, options)

    if (payload.length > maxBatchSize) {
      return reject(new ORPCError('PAYLOAD_TOO_LARGE', { message: `Batch size exceeds the maximum of ${maxBatchSize}.` }))
    }

    const results = await Promise.all(payload.map(item => this.call(options, item, true)))
    const responses = results.flatMap(({ response }) => response ? [response] : [])

    // a batch of only notifications is answered with nothing, never an empty array
    return reply(responses.length ? responses : undefined, results.reduce<StandardHeaders>((merged, { headers }) => mergeStandardHeaders(merged, headers), {}))
  }

  /**
   * Runs one call through `StandardHandler`, as a sub-request whose body is its `params`.
   * Notifications run to completion too, but are never answered.
   */
  private async call(
    options: StandardHandlerRoutingInterceptorOptions<T>,
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
      result = method === 'rpc.discover' && this.discovery
        ? await this.discover(options)
        : await super.handle(request, { prefix: options.prefix, context: options.context })
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
   * Answers `rpc.discover` with the document, or with the `ORPCError` `spec` throws. Other errors are unexpected, see `.call`.
   */
  private async discover(options: StandardHandlerRoutingInterceptorOptions<T>): Promise<StandardHandlerHandleResult> {
    try {
      return { matched: true, response: { status: 200, headers: {}, body: { result: await value(this.discovery!.spec, options) } } }
    }
    catch (error) {
      if (!(error instanceof ORPCError)) {
        throw error
      }

      return { matched: true, response: { status: 200, headers: {}, body: { error: encodeJsonRpcError(error, this.serializer, this.errorCodeMap) } } }
    }
  }

  private async serveSpec(options: StandardHandlerRoutingInterceptorOptions<T>): Promise<StandardHandlerHandleResult> {
    const { request, prefix } = options
    const specPath = this.discovery?.specPath ?? '/openrpc.json'

    if (!this.discovery || specPath === false || !matchesHttpPath(request.url, prefix ? mergeHttpPath(prefix, specPath) : specPath)) {
      return { matched: false }
    }

    try {
      return { matched: true, response: { status: 200, headers: {}, body: await value(this.discovery.spec, options) } }
    }
    catch (error) {
      if (error instanceof ORPCError) {
        return this.reject(error)
      }

      throw error
    }
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
