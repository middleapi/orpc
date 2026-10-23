import type { COMMON_ERROR_STATUS_MAP } from '@orpc/client'

export const JSON_RPC_VERSION = '2.0'

/**
 * Error codes the JSON-RPC 2.0 specification reserves for protocol errors.
 */
export const JSON_RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const

/**
 * Default mapping between common oRPC error codes and JSON-RPC error codes.
 * Spread it to build a custom `errorCodeMap`.
 *
 * @see {@link https://orpc.dev/docs/openrpc/handler#error-codes | OpenRPC Handler - Error Codes}
 */
export const COMMON_JSON_RPC_ERROR_CODE_MAP = {
  BAD_REQUEST: -32602,
  UNAUTHORIZED: -32001,
  PAYMENT_REQUIRED: -32002,
  FORBIDDEN: -32003,
  NOT_FOUND: -32004,
  METHOD_NOT_SUPPORTED: -32005,
  NOT_ACCEPTABLE: -32006,
  TIMEOUT: -32008,
  CONFLICT: -32009,
  GONE: -32010,
  LENGTH_REQUIRED: -32011,
  PRECONDITION_FAILED: -32012,
  PAYLOAD_TOO_LARGE: -32013,
  UNSUPPORTED_MEDIA_TYPE: -32015,
  UNPROCESSABLE_CONTENT: -32022,
  PRECONDITION_REQUIRED: -32028,
  TOO_MANY_REQUESTS: -32029,
  CLIENT_CLOSED_REQUEST: -32099,
  INTERNAL_SERVER_ERROR: -32603,
  NOT_IMPLEMENTED: -32603,
  BAD_GATEWAY: -32603,
  SERVICE_UNAVAILABLE: -32603,
  GATEWAY_TIMEOUT: -32603,
} satisfies Record<keyof typeof COMMON_ERROR_STATUS_MAP, number>

/**
 * The JSON-RPC error code of ORPCError codes missing from the error code map (an implementation-defined server error).
 */
export const DEFAULT_JSON_RPC_ERROR_CODE = -32000

export const DEFAULT_JSON_RPC_MAX_BATCH_SIZE = 100
