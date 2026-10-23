import type { AnyORPCError } from '@orpc/client'
import type { OpenAPIJsonSerializer } from '@orpc/openapi'
import type { Public } from '@orpc/shared'
import type { StandardBody, StandardHeaders } from '@standard-server/core'
import type { JsonRpcErrorObject, JsonRpcErrorResponse, JsonRpcId, JsonRpcParams, JsonRpcResponse, OpenRPCErrorData } from '../../json-rpc'
import { COMMON_ERROR_STATUS_MAP } from '@orpc/client'
import { DEFAULT_ERROR_STATUS } from '@orpc/server'
import { getOwn, isAsyncIteratorObject, isPlainObject, toArray } from '@orpc/shared'
import { cancelStandardBody, flattenStandardHeader } from '@standard-server/core'
import { JSON_RPC_ERROR_CODES, JSON_RPC_VERSION } from '../../constants'
import { isJsonRpcErrorObject, toJsonRpcErrorCode } from '../../json-rpc'
import { assertJsonRpcErrorCodeMap, isJsonRpcId } from '../../utils'

/**
 * Media types accepted for JSON-RPC request bodies. None is CORS-safelisted, so a cross-site
 * request carrying one always needs a preflight, which keeps the endpoint safe from CSRF.
 */
const JSON_RPC_MEDIA_TYPES = new Set(['application/json', 'application/json-rpc', 'application/jsonrequest'])

/**
 * Whether a `content-type` header names a JSON-RPC media type (parameters such as `charset` are ignored).
 */
export function isJsonRpcMediaType(contentType: string | readonly string[] | undefined): boolean {
  const mediaType = flattenStandardHeader(contentType)?.split(';')[0]?.trim().toLowerCase()

  return mediaType !== undefined && JSON_RPC_MEDIA_TYPES.has(mediaType)
}

type ParsedJsonRpcRequest
  = | {
    valid: true
    method: string
    /**
     * `null` params are treated as absent.
     */
    params: JsonRpcParams | undefined
    /**
     * `undefined` for notifications.
     */
    id: JsonRpcId | undefined
    notification: boolean
  }
  | {
    valid: false
    /**
     * The request's `id` when it has one of a valid type, otherwise `null`.
     */
    id: JsonRpcId
  }

/**
 * Validates one JSON-RPC request object (a single request or a batch item).
 *
 * Only own properties count, and a member whose value is `undefined` is treated as absent, as in JSON.
 * An invalid object keeps its `id` when it has a valid one, so the "Invalid Request" error can be correlated.
 */
export function parseJsonRpcRequest(item: unknown): ParsedJsonRpcRequest {
  if (!isPlainObject(item)) {
    return { valid: false, id: null }
  }

  const id = getOwn(item, 'id')
  const method = getOwn(item, 'method')
  const params = getOwn(item, 'params')

  if (
    getOwn(item, 'jsonrpc') !== JSON_RPC_VERSION
    || typeof method !== 'string'
    || (id !== undefined && !isJsonRpcId(id))
    || (params !== undefined && params !== null && !Array.isArray(params) && !isPlainObject(params))
  ) {
    return { valid: false, id: isJsonRpcId(id) ? id : null }
  }

  return {
    valid: true,
    method,
    params: (params ?? undefined) as JsonRpcParams | undefined,
    id: id as JsonRpcId | undefined,
    notification: id === undefined,
  }
}

export interface EncodeJsonRpcErrorOptions {
  serializer: Public<OpenAPIJsonSerializer>
  /**
   * @default COMMON_JSON_RPC_ERROR_CODE_MAP
   */
  errorCodeMap?: Record<string, number> | undefined
  customErrorEncoder?: ((error: AnyORPCError) => JsonRpcErrorObject | null | undefined) | undefined
}

/**
 * Builds the JSON-RPC error object for an `ORPCError`: the custom encoder's result when it returns one,
 * otherwise the mapped code, the error message, and {@link OpenRPCErrorData} as `data`.
 */
export function encodeJsonRpcError(error: AnyORPCError, options: EncodeJsonRpcErrorOptions): JsonRpcErrorObject {
  const custom = options.customErrorEncoder?.(error)

  if (custom !== undefined && custom !== null) {
    return custom
  }

  const data: OpenRPCErrorData = {
    code: error.code,
    defined: error.defined,
    ...(error.data === undefined ? {} : { data: error.data }),
  }

  return {
    code: toJsonRpcErrorCode(error.code, options.errorCodeMap),
    message: error.message,
    data: options.serializer.serializeJson(data).json,
  }
}

export interface JsonRpcErrorEncoderOptions extends EncodeJsonRpcErrorOptions {
  /**
   * @default COMMON_ERROR_STATUS_MAP
   */
  errorStatusMap?: Record<string, number> | undefined
}

/**
 * An `ORPCError` encoded as a JSON-RPC error object, with the HTTP status of its per-call response.
 */
export interface EncodedJsonRpcError {
  status: number
  error: JsonRpcErrorObject
}

/**
 * Validates the error options once and returns the encoder the codec and the envelope plugin share.
 *
 * @throws {TypeError} If an `errorCodeMap` value is not an integer.
 */
export function createJsonRpcErrorEncoder(options: JsonRpcErrorEncoderOptions, owner: string): (error: AnyORPCError) => EncodedJsonRpcError {
  assertJsonRpcErrorCodeMap(options.errorCodeMap, owner)

  const errorStatusMap = options.errorStatusMap ?? COMMON_ERROR_STATUS_MAP
  const encodeOptions: EncodeJsonRpcErrorOptions = {
    serializer: options.serializer,
    errorCodeMap: options.errorCodeMap,
    customErrorEncoder: options.customErrorEncoder,
  }

  return error => ({
    status: getOwn(errorStatusMap, error.code) ?? DEFAULT_ERROR_STATUS,
    error: encodeJsonRpcError(error, encodeOptions),
  })
}

/**
 * A JSON-RPC protocol error code produced by the envelope itself.
 */
export type JsonRpcProtocolErrorCode = typeof JSON_RPC_ERROR_CODES[keyof typeof JSON_RPC_ERROR_CODES]

/**
 * The canonical messages of the JSON-RPC 2.0 specification.
 */
const JSON_RPC_PROTOCOL_ERROR_MESSAGES: Record<JsonRpcProtocolErrorCode, string> = {
  [JSON_RPC_ERROR_CODES.PARSE_ERROR]: 'Parse error',
  [JSON_RPC_ERROR_CODES.INVALID_REQUEST]: 'Invalid Request',
  [JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND]: 'Method not found',
  [JSON_RPC_ERROR_CODES.INVALID_PARAMS]: 'Invalid params',
  [JSON_RPC_ERROR_CODES.INTERNAL_ERROR]: 'Internal error',
}

/**
 * A protocol error response with the canonical message and no `data`, exactly as the specification's examples.
 */
export function createJsonRpcProtocolErrorResponse(id: JsonRpcId, code: JsonRpcProtocolErrorCode): JsonRpcErrorResponse<never> {
  return { jsonrpc: JSON_RPC_VERSION, id, error: { code, message: JSON_RPC_PROTOCOL_ERROR_MESSAGES[code] } }
}

/**
 * Whether a header describes a response's own body, which the JSON-RPC response (or batch) does not share.
 */
function isBodyHeader(name: string): boolean {
  return name.startsWith('content-') || name === 'standard-server'
}

/**
 * Copies headers without the ones describing the body (`content-*`, `standard-server`) and undefined values.
 */
export function omitBodyHeaders(headers: StandardHeaders): StandardHeaders {
  const result: StandardHeaders = {}

  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !isBodyHeader(name)) {
      result[name] = value
    }
  }

  return result
}

/**
 * Builds the batch response headers: the headers the subresponses all have with the same value, and
 * the distinct cookies and `vary` fields of all of them. A cache must vary on whatever any subresponse varies on.
 *
 * Keep in sync with `liftSubresponseHeaders` in `packages/server/src/plugins/batch.ts` (minus the batch headers).
 */
export function liftSubresponseHeaders(subresponseHeaders: readonly StandardHeaders[]): StandardHeaders {
  const [first = {}, ...rest] = subresponseHeaders
  const headers: StandardHeaders = {}

  for (const [name, value] of Object.entries(first)) {
    if (value === undefined || isBodyHeader(name)) {
      continue
    }

    const flattened = flattenStandardHeader(value)

    if (rest.every(other => flattenStandardHeader(other[name]) === flattened)) {
      headers[name] = value
    }
  }

  const cookies = new Set(subresponseHeaders.flatMap(other => toArray(other['set-cookie'])))

  if (cookies.size > 0) {
    headers['set-cookie'] = [...cookies]
  }

  const varies = new Map<string, string>()

  for (const value of subresponseHeaders.flatMap(other => toArray(other.vary))) {
    for (const field of value.split(',')) {
      const name = field.trim()
      const key = name.toLowerCase()

      if (name && !varies.has(key)) {
        varies.set(key, name)
      }
    }
  }

  if (varies.size > 0) {
    headers.vary = varies.has('*') ? '*' : [...varies.values()].join(', ')
  }

  return headers
}

/**
 * Whether `JSON.stringify` keeps a value as an object member: `undefined`, functions, and symbols are dropped,
 * which would leave a response without its required `result` member.
 */
export function isJsonMemberValue(value: unknown): boolean {
  return value !== undefined && typeof value !== 'function' && typeof value !== 'symbol'
}

/**
 * Completes the body of a per-call sub-response, `{ result }` or `{ error }`, into the JSON-RPC response for `id`.
 * Returns `undefined` unless the body is a plain object with exactly one own `result` (that JSON keeps,
 * see {@link isJsonMemberValue}) or valid `error` member. Other keys are ignored.
 */
export function completeJsonRpcResponse(body: unknown, id: JsonRpcId): JsonRpcResponse | undefined {
  if (!isPlainObject(body)) {
    return undefined
  }

  const hasResult = Object.hasOwn(body, 'result')

  if (hasResult === Object.hasOwn(body, 'error')) {
    return undefined
  }

  if (hasResult) {
    return isJsonMemberValue(body.result) ? { jsonrpc: JSON_RPC_VERSION, id, result: body.result } : undefined
  }

  return isJsonRpcErrorObject(body.error) ? { jsonrpc: JSON_RPC_VERSION, id, error: body.error } : undefined
}

/**
 * Describes a value JSON-RPC cannot carry as a whole: a stream, an event iterator, or a form or binary body.
 * Returns `undefined` for any other value.
 */
export function getUnsupportedValueKind(value: unknown): string | undefined {
  if (value instanceof ReadableStream) {
    return 'a ReadableStream'
  }

  if (isAsyncIteratorObject(value)) {
    return 'an AsyncIteratorObject'
  }

  if (value instanceof Blob) {
    return 'a Blob'
  }

  if (typeof FormData !== 'undefined' && value instanceof FormData) {
    return 'a FormData'
  }

  if (typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams) {
    return 'a URLSearchParams'
  }

  return undefined
}

/**
 * Cancels a body that will not be sent, ignoring cleanup failures.
 */
export async function cancelQuietly(body: StandardBody): Promise<void> {
  await cancelStandardBody(body).catch(() => {})
}
