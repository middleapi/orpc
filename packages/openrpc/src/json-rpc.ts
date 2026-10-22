import type { ORPCErrorCode } from '@orpc/client'
import { getOwn, isPlainObject } from '@orpc/shared'
import { COMMON_JSON_RPC_ERROR_CODE_MAP, DEFAULT_JSON_RPC_ERROR_CODE, JSON_RPC_ERROR_CODES, JSON_RPC_VERSION } from './constants'
import { isJsonRpcId } from './utils'

/**
 * A JSON-RPC request id. Fractional numbers are allowed but discouraged by the specification.
 */
export type JsonRpcId = string | number | null

/**
 * JSON-RPC params: by-position (array) or by-name (object).
 */
export type JsonRpcParams = unknown[] | Record<string, unknown>

/**
 * A JSON-RPC 2.0 request object. Without an `id` member it is a notification, which is never answered.
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0'
  method: string
  params?: JsonRpcParams
  id?: JsonRpcId
}

/**
 * The `error` member of a JSON-RPC 2.0 error response.
 */
export interface JsonRpcErrorObject<TData = unknown> {
  code: number
  message: string
  data?: TData
}

export interface JsonRpcSuccessResponse<TResult = unknown> {
  jsonrpc: '2.0'
  id: JsonRpcId
  result: TResult
}

export interface JsonRpcErrorResponse<TData = unknown> {
  jsonrpc: '2.0'
  id: JsonRpcId
  error: JsonRpcErrorObject<TData>
}

/**
 * A JSON-RPC 2.0 response object.
 */
export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse

/**
 * The `error.data` of JSON-RPC errors produced from an `ORPCError`, which keeps the oRPC error code
 * and `defined` flag so typed errors survive the round trip. The `data` key is omitted when undefined.
 *
 * @see {@link https://orpc.dev/docs/openrpc/protocol#error-codes | JSON-RPC Protocol - Error Codes}
 */
export interface OpenRPCErrorData {
  code: string
  defined: boolean
  data?: unknown
}

const OPENRPC_ERROR_DATA_KEYS = new Set(['code', 'defined', 'data'])

/**
 * Whether a value is a JSON-RPC error object: an integer `code` and a string `message`, as own properties.
 */
export function isJsonRpcErrorObject(value: unknown): value is JsonRpcErrorObject {
  return isPlainObject(value)
    && Number.isInteger(getOwn(value, 'code'))
    && typeof getOwn(value, 'message') === 'string'
}

/**
 * Whether a value is a JSON-RPC 2.0 response object: `jsonrpc: "2.0"`, a valid `id`,
 * and exactly one of `result` and a valid `error`, all as own properties.
 */
export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  if (!isPlainObject(value) || getOwn(value, 'jsonrpc') !== JSON_RPC_VERSION) {
    return false
  }

  if (!Object.hasOwn(value, 'id') || !isJsonRpcId(value.id)) {
    return false
  }

  const hasResult = Object.hasOwn(value, 'result')
  const hasError = Object.hasOwn(value, 'error')

  if (hasResult === hasError) {
    return false
  }

  return hasResult || isJsonRpcErrorObject(value.error)
}

/**
 * Whether a JSON-RPC `error.data` value is {@link OpenRPCErrorData}, as produced from an `ORPCError`:
 * a string `code` and a boolean `defined`, with no own keys besides `code`, `defined`, and `data`.
 */
export function isOpenRPCErrorData(value: unknown): value is OpenRPCErrorData {
  return isPlainObject(value)
    && typeof getOwn(value, 'code') === 'string'
    && typeof getOwn(value, 'defined') === 'boolean'
    && Object.keys(value).every(key => OPENRPC_ERROR_DATA_KEYS.has(key))
}

/**
 * Converts an `ORPCError` code into a JSON-RPC error code.
 * Only own properties of the map are used; missing codes fall back to {@link DEFAULT_JSON_RPC_ERROR_CODE}.
 * A given `errorCodeMap` replaces (does not extend) {@link COMMON_JSON_RPC_ERROR_CODE_MAP}.
 *
 * @see {@link https://orpc.dev/docs/openrpc/protocol#error-codes | JSON-RPC Protocol - Error Codes}
 */
export function toJsonRpcErrorCode(code: string, errorCodeMap?: Record<string, number> | undefined): number {
  return getOwn(errorCodeMap ?? COMMON_JSON_RPC_ERROR_CODE_MAP, code) ?? DEFAULT_JSON_RPC_ERROR_CODE
}

const JSON_RPC_TO_ORPC_ERROR_CODE = (() => {
  const map = new Map<number, string>([
    [JSON_RPC_ERROR_CODES.PARSE_ERROR, 'BAD_REQUEST'],
    [JSON_RPC_ERROR_CODES.INVALID_REQUEST, 'BAD_REQUEST'],
    [JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND, 'NOT_FOUND'],
    [JSON_RPC_ERROR_CODES.INVALID_PARAMS, 'BAD_REQUEST'],
    [JSON_RPC_ERROR_CODES.INTERNAL_ERROR, 'INTERNAL_SERVER_ERROR'],
  ])

  for (const [code, jsonRpcCode] of Object.entries(COMMON_JSON_RPC_ERROR_CODE_MAP)) {
    if (!map.has(jsonRpcCode)) {
      map.set(jsonRpcCode, code)
    }
  }

  return map
})()

/**
 * Converts a JSON-RPC error code into the closest common `ORPCError` code, for errors without
 * {@link OpenRPCErrorData}, such as those from other JSON-RPC servers.
 *
 * Parse errors, invalid requests, and invalid params become `BAD_REQUEST`, "Method not found" becomes `NOT_FOUND`,
 * other codes of {@link COMMON_JSON_RPC_ERROR_CODE_MAP} its first matching key, and anything else `INTERNAL_SERVER_ERROR`.
 *
 * @see {@link https://orpc.dev/docs/openrpc/link#error-responses | OpenRPC Link - Error Responses}
 */
export function fromJsonRpcErrorCode(code: number): ORPCErrorCode {
  return (JSON_RPC_TO_ORPC_ERROR_CODE.get(code) ?? 'INTERNAL_SERVER_ERROR') as ORPCErrorCode
}
