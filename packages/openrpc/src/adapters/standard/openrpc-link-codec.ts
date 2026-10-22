import type { AnyORPCError, ClientContext, ClientOptions } from '@orpc/client'
import type { StandardLinkCodec, StandardLinkCodecDecodedResponse } from '@orpc/client/standard'
import type { Promisable, Public, Value } from '@orpc/shared'
import type { StandardBody, StandardHeaders, StandardLazyResponse, StandardRequest, StandardResponse, StandardUrl } from '@standard-server/core'
import type { JsonRpcErrorObject, JsonRpcErrorResponse, JsonRpcParams, JsonRpcRequest, JsonRpcSuccessResponse } from '../../json-rpc'
import { COMMON_ERROR_STATUS_MAP, createORPCErrorFromJson, MalformedResponseError, ORPCError, ResponseError } from '@orpc/client'
import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { DEFAULT_ERROR_STATUS } from '@orpc/server'
import { getOwn, isAsyncIteratorObject, isPlainObject, value } from '@orpc/shared'
import { toStandardHeaders } from '@standard-server/fetch'
import { JSON_RPC_VERSION } from '../../constants'
import { fromJsonRpcErrorCode, isJsonRpcResponse, isOpenRPCErrorData } from '../../json-rpc'
import { JSON_RPC_METHOD_SEPARATOR } from '../../utils'
import { encodeJsonRpcParams } from './params'
import { cancelQuietly, isJsonRpcMediaType } from './utils'

export interface OpenRPCLinkCodecOptions<T extends ClientContext> {
  /**
   * URL of the JSON-RPC endpoint, without origin. Should match the handler's prefix.
   * Every call is sent to this URL; the procedure path becomes the JSON-RPC `method`.
   *
   * @example '/rpc'
   * @default '/'
   */
  url?: Value<Promisable<StandardUrl>, [options: ClientOptions<T>, path: string[], input: unknown]> | undefined

  /**
   * Inject headers into the request.
   */
  headers?: Value<Promisable<StandardHeaders | Headers>, [options: ClientOptions<T>, path: string[], input: unknown]> | undefined

  /**
   * Send the call as a JSON-RPC notification (a request without `id`), which the server never answers.
   * The call resolves `undefined` once the server accepts it, or rejects with the error the server reports, if any.
   * Client types are not affected: the call keeps its output type, but still resolves `undefined`.
   *
   * @default false
   * @see {@link https://orpc.dev/docs/openrpc/link#notifications | OpenRPC Link - Notifications}
   */
  notification?: Value<Promisable<boolean>, [options: ClientOptions<T>, path: string[], input: unknown]> | undefined

  /**
   * Replace the mapping from the serialized input to JSON-RPC `params`, for example `(input) => input`
   * to spread a tuple for servers that take several positional params.
   * It receives the serialized input (`undefined` when the input is `undefined`); return `undefined` to omit `params`.
   *
   * By default, `undefined` omits `params`, a plain object is sent by-name, and anything else by-position as `[input]`.
   *
   * @see {@link https://orpc.dev/docs/openrpc/link#positional-params | OpenRPC Link - Positional Params}
   */
  encodeParams?: ((serializedInput: unknown, path: readonly string[]) => JsonRpcParams | undefined) | undefined

  /**
   * Serializes the input into JSON.
   *
   * @default new OpenAPIJsonSerializer()
   */
  serializer?: Public<OpenAPIJsonSerializer> | undefined

  /**
   * Maps an oRPC error code to the HTTP status set on `ResponseError.response.status` (the `cause`
   * of decoded errors) when the error arrives in a response with a status below 400, as JSON-RPC servers usually reply 200.
   * Plugins that decide by status, such as `RetryLinkPlugin`, then treat it as they would an HTTP error.
   * Codes missing from the map fall back to `DEFAULT_ERROR_STATUS` (400).
   *
   * @default COMMON_ERROR_STATUS_MAP
   * @see {@link https://orpc.dev/docs/openrpc/link#error-responses | OpenRPC Link - Error Responses}
   */
  errorStatusMap?: Record<string, number> | undefined

  /**
   * Convert a JSON-RPC error object into an `ORPCError`.
   * Return `null` or `undefined` to fall back to the default decoding behavior.
   *
   * A returned error without a `cause` gets the same `ResponseError` cause as default-decoded errors,
   * with the status derived from the returned error's code (see `errorStatusMap`).
   *
   * @see {@link https://orpc.dev/docs/openrpc/link#error-responses | OpenRPC Link - Error Responses}
   */
  customErrorDecoder?: ((
    error: JsonRpcErrorObject,
    response: StandardLazyResponse,
  ) => AnyORPCError | null | undefined) | undefined
}

/**
 * The JSON-RPC call a request was encoded as, kept until its response is decoded.
 */
interface OpenRPCLinkCall {
  /**
   * `undefined` for notifications.
   */
  id: number | undefined
  notification: boolean
}

const UNSUPPORTED_INPUT_MESSAGE = '[OpenRPCLink] JSON-RPC cannot send Blob, File, FormData, URLSearchParams, or streams'

/**
 * Codec for `StandardLink` that sends each call as a JSON-RPC 2.0 request (`method` is the procedure path joined by `.`)
 * and decodes JSON-RPC responses, restoring `ORPCError`s, including their `defined` flag, from oRPC servers.
 * It needs no contract.
 *
 * @see {@link https://orpc.dev/docs/openrpc/link | OpenRPC Link}
 */
export class OpenRPCLinkCodec<T extends ClientContext> implements StandardLinkCodec<T> {
  private readonly baseUrl: Exclude<OpenRPCLinkCodecOptions<T>['url'], undefined>
  private readonly headers: Exclude<OpenRPCLinkCodecOptions<T>['headers'], undefined>
  private readonly notification: Exclude<OpenRPCLinkCodecOptions<T>['notification'], undefined>
  private readonly encodeParams: OpenRPCLinkCodecOptions<T>['encodeParams']
  private readonly serializer: Exclude<OpenRPCLinkCodecOptions<T>['serializer'], undefined>
  private readonly errorStatusMap: Exclude<OpenRPCLinkCodecOptions<T>['errorStatusMap'], undefined>
  private readonly customErrorDecoder: OpenRPCLinkCodecOptions<T>['customErrorDecoder']

  /**
   * `StandardLink` passes the same `options` object to `encodeInput` and `decodeResponse`,
   * and a new one for every attempt, so it identifies the call a response answers.
   */
  private readonly calls = new WeakMap<ClientOptions<T>, OpenRPCLinkCall>()
  private lastId = 0

  constructor(options: OpenRPCLinkCodecOptions<T> = {}) {
    this.baseUrl = options.url ?? '/'
    this.headers = options.headers ?? {}
    this.notification = options.notification ?? false
    this.encodeParams = options.encodeParams
    this.serializer = options.serializer ?? new OpenAPIJsonSerializer()
    this.errorStatusMap = options.errorStatusMap ?? COMMON_ERROR_STATUS_MAP
    this.customErrorDecoder = options.customErrorDecoder
  }

  async encodeInput(input: unknown, path: string[], options: ClientOptions<T>): Promise<StandardRequest> {
    const params = this.encodeJsonRpcParams(input, path)

    const headers = toResolvedStandardHeaders(await value(this.headers, options, path, input))
    const url = await value(this.baseUrl, options, path, input)
    const notification = await value(this.notification, options, path, input)
    const id = notification ? undefined : this.generateId()

    const body: JsonRpcRequest = {
      jsonrpc: JSON_RPC_VERSION,
      method: path.join(JSON_RPC_METHOD_SEPARATOR),
      ...(params !== undefined && { params }),
      ...(id !== undefined && { id }),
    }

    this.calls.set(options, { id, notification })

    return {
      method: 'POST',
      url,
      headers,
      body,
      signal: options.signal,
    }
  }

  async decodeResponse(
    response: StandardLazyResponse,
    _path: string[],
    options: ClientOptions<T>,
  ): Promise<StandardLinkCodecDecodedResponse> {
    const call = this.calls.get(options)
    let body: StandardBody

    try {
      body = await response.resolveBody(isJsonRpcMediaType(response.headers['content-type']) ? 'json' : undefined)
    }
    catch (cause) {
      if (options.signal?.aborted) {
        throw cause
      }

      throw new MalformedResponseError({
        message: 'Failed to read the JSON-RPC response body.',
        response: { status: response.status, headers: response.headers, body: undefined },
        cause,
      })
    }

    const snapshot: StandardResponse = { status: response.status, headers: response.headers, body }

    if (call?.notification) {
      if (isJsonRpcResponse(body) && Object.hasOwn(body, 'error')) {
        return { kind: 'error', error: this.decodeError((body as JsonRpcErrorResponse).error, snapshot, response) }
      }

      if (response.status < 400) {
        await cancelQuietly(body)
        return { kind: 'output', output: undefined }
      }

      throw new MalformedResponseError({ response: snapshot })
    }

    if (!isJsonRpcResponse(body)) {
      throw new MalformedResponseError({
        // a non-JSON-RPC error response (e.g. from a proxy) is better described by its status
        message: response.status < 400 ? 'Invalid JSON-RPC response.' : undefined,
        response: snapshot,
      })
    }

    const isError = Object.hasOwn(body, 'error')

    if (call !== undefined && body.id !== call.id && !(isError && body.id === null)) {
      throw new MalformedResponseError({
        message: 'JSON-RPC response id does not match the request id.',
        response: snapshot,
      })
    }

    if (!isError) {
      return { kind: 'output', output: (body as JsonRpcSuccessResponse).result }
    }

    return { kind: 'error', error: this.decodeError((body as JsonRpcErrorResponse).error, snapshot, response) }
  }

  private encodeJsonRpcParams(input: unknown, path: readonly string[]): JsonRpcParams | undefined {
    if (isUnsupportedInput(input)) {
      throw new TypeError(`${UNSUPPORTED_INPUT_MESSAGE} in call to procedure (${path.join(JSON_RPC_METHOD_SEPARATOR)}).`)
    }

    let json: unknown

    if (input !== undefined) {
      const serialized = this.serializer.serializeJson(input)

      if (serialized.blobs?.length) {
        throw new TypeError(`${UNSUPPORTED_INPUT_MESSAGE} in call to procedure (${path.join(JSON_RPC_METHOD_SEPARATOR)}).`)
      }

      json = serialized.json
    }

    if (this.encodeParams === undefined) {
      return encodeJsonRpcParams(json)
    }

    const params = this.encodeParams(json, path)

    if (params !== undefined && !Array.isArray(params) && !isPlainObject(params)) {
      throw new TypeError(
        `[OpenRPCLink] "encodeParams" must return an array, a plain object, or undefined in call to procedure (${path.join(JSON_RPC_METHOD_SEPARATOR)}).`,
      )
    }

    return params
  }

  /**
   * Request ids are 1, 2, 3, ... per codec, wrapping before they lose integer precision.
   */
  private generateId(): number {
    this.lastId = this.lastId >= Number.MAX_SAFE_INTEGER ? 1 : this.lastId + 1

    return this.lastId
  }

  private decodeError(error: JsonRpcErrorObject, snapshot: StandardResponse, response: StandardLazyResponse): AnyORPCError {
    const customError = this.customErrorDecoder?.(error, response)

    if (customError !== undefined && customError !== null) {
      if (customError.cause === undefined) {
        // like the `cause` option of `new Error`: an own, non-enumerable property
        Object.defineProperty(customError, 'cause', {
          value: this.createResponseError(error, snapshot, customError.code),
          writable: true,
          configurable: true,
        })
      }

      return customError
    }

    const data = error.data
    const lossless = isOpenRPCErrorData(data)
    const code = lossless ? data.code : fromJsonRpcErrorCode(error.code)
    const cause = this.createResponseError(error, snapshot, code)

    if (lossless) {
      return createORPCErrorFromJson({ code, defined: data.defined, message: error.message, data: data.data }, { cause })
    }

    return new ORPCError(code, { message: error.message, data, cause })
  }

  /**
   * The `cause` of a decoded error. JSON-RPC servers usually deliver errors with 200, so a status below 400
   * is replaced with the status of the oRPC error `code`, which status-based plugins (such as retry) understand.
   */
  private createResponseError(error: JsonRpcErrorObject, snapshot: StandardResponse, code: string): ResponseError {
    return new ResponseError({
      message: `Received JSON-RPC error ${error.code}.`,
      response: {
        ...snapshot,
        status: snapshot.status >= 400 ? snapshot.status : getOwn(this.errorStatusMap, code) ?? DEFAULT_ERROR_STATUS,
      },
    })
  }
}

function isUnsupportedInput(input: unknown): boolean {
  return input instanceof Blob
    || (typeof ReadableStream !== 'undefined' && input instanceof ReadableStream)
    || (typeof FormData !== 'undefined' && input instanceof FormData)
    || (typeof URLSearchParams !== 'undefined' && input instanceof URLSearchParams)
    || isAsyncIteratorObject(input)
}

function toResolvedStandardHeaders(headers: Headers | StandardHeaders): StandardHeaders {
  /**
   * Headers class might not be available in some environments,
   * so we check for the existence of `forEach` and `get`
   * methods to determine if it's a Headers instance.
   */
  if (typeof headers.forEach === 'function') {
    return toStandardHeaders(headers as Headers)
  }

  return headers as StandardHeaders
}
