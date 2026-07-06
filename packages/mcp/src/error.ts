import type { JSONRPCErrorObject } from './types'
import { toORPCError } from '@orpc/client'
import { INTERNAL_ERROR, INVALID_PARAMS, METHOD_NOT_FOUND, RESOURCE_NOT_FOUND } from './constants'

/**
 * JSON-RPC numeric error code for a given {@link ORPCError} string code.
 * Anything not listed collapses to `INTERNAL_ERROR` (-32603).
 */
const JSONRPC_CODE_BY_ORPC: Record<string, number> = {
  METHOD_NOT_FOUND,
  INVALID_PARAMS,
  BAD_REQUEST: INVALID_PARAMS,
  INPUT_VALIDATION_FAILED: INVALID_PARAMS,
  NOT_FOUND: RESOURCE_NOT_FOUND,
}

/**
 * Map any thrown value to a JSON-RPC error object. The value is normalized to
 * an `ORPCError` first (the oRPC-native error type) — its string `code` selects
 * the JSON-RPC numeric code and its `data`, when present, is surfaced to the
 * client. Unrecognized/unexpected errors become a generic internal error.
 *
 * This is the single boundary where oRPC errors become JSON-RPC wire errors;
 * everywhere else throws plain `ORPCError`.
 */
export function toJSONRPCError(error: unknown): JSONRPCErrorObject {
  const orpcError = toORPCError(error)
  const code = JSONRPC_CODE_BY_ORPC[orpcError.code] ?? INTERNAL_ERROR
  return orpcError.data !== undefined
    ? { code, message: orpcError.message, data: orpcError.data }
    : { code, message: orpcError.message }
}
