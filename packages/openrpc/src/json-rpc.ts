import type { AnyORPCError, ORPCErrorCode } from '@orpc/client'
import type { OpenAPIJsonSerializer } from '@orpc/openapi'
import type { Public } from '@orpc/shared'
import { getOwn, isPlainObject } from '@orpc/shared'
import { COMMON_JSON_RPC_ERROR_CODE_MAP, DEFAULT_JSON_RPC_ERROR_CODE, JSON_RPC_ERROR_CODES, JSON_RPC_VERSION } from './constants'

export type JsonRpcId = string | number | null

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  method: string
  params?: unknown[] | Record<string, unknown> | undefined
  /**
   * Absent for notifications.
   */
  id?: JsonRpcId | undefined
}

export interface JsonRpcErrorObject {
  code: number
  message: string
  data?: unknown
}

export type JsonRpcResponse
  = | { jsonrpc: '2.0', id: JsonRpcId, result: unknown }
    | { jsonrpc: '2.0', id: JsonRpcId, error: JsonRpcErrorObject }

export function isJsonRpcId(value: unknown): value is JsonRpcId {
  return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
}

export function isJsonRpcErrorObject(value: unknown): value is JsonRpcErrorObject {
  return isPlainObject(value) && Number.isInteger(getOwn(value, 'code')) && typeof getOwn(value, 'message') === 'string'
}

/**
 * Whether a value has exactly one own `result` or valid `error` member, like a JSON-RPC response.
 */
export function hasJsonRpcResultOrError(value: unknown): value is { result: unknown } | { error: JsonRpcErrorObject } {
  if (!isPlainObject(value)) {
    return false
  }

  const hasResult = Object.hasOwn(value, 'result')

  return hasResult !== Object.hasOwn(value, 'error') && (hasResult || isJsonRpcErrorObject(value.error))
}

/**
 * Whether a value is a JSON-RPC response: exactly one own `result` or valid `error` member, and a valid `id`.
 */
export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  return hasJsonRpcResultOrError(value) && getOwn(value, 'jsonrpc') === JSON_RPC_VERSION && isJsonRpcId(getOwn(value, 'id'))
}

/**
 * Encodes an ORPCError as a JSON-RPC error object, keeping its oRPC `code`, `defined` flag and `data` in `data`.
 */
export function encodeJsonRpcError(
  error: AnyORPCError,
  serializer: Public<OpenAPIJsonSerializer>,
  errorCodeMap: Record<string, number> = COMMON_JSON_RPC_ERROR_CODE_MAP,
): JsonRpcErrorObject {
  return {
    code: getOwn(errorCodeMap, error.code) ?? DEFAULT_JSON_RPC_ERROR_CODE,
    message: error.message,
    data: serializer.serializeJson({ code: error.code, defined: error.defined, data: error.data }).json,
  }
}

const PROTOCOL_ERROR_ORPC_CODES = new Map<number, ORPCErrorCode>([
  [JSON_RPC_ERROR_CODES.PARSE_ERROR, 'BAD_REQUEST'],
  [JSON_RPC_ERROR_CODES.INVALID_REQUEST, 'BAD_REQUEST'],
  [JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND, 'NOT_FOUND'],
])

/**
 * The ORPCError code of a JSON-RPC error code that carries no oRPC code, such as one from another server.
 */
export function fromJsonRpcErrorCode(code: number): ORPCErrorCode {
  return PROTOCOL_ERROR_ORPC_CODES.get(code)
    ?? Object.keys(COMMON_JSON_RPC_ERROR_CODE_MAP).find(key => getOwn(COMMON_JSON_RPC_ERROR_CODE_MAP, key) === code)
    ?? 'INTERNAL_SERVER_ERROR'
}
