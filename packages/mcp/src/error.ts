import type { JSONRPCErrorObject } from './types'
import { toORPCError } from '@orpc/client'
import { INTERNAL_ERROR, INVALID_PARAMS, RESOURCE_NOT_FOUND } from './constants'

/**
 * A JSON-RPC protocol error. Thrown inside the dispatcher to produce a
 * JSON-RPC error response (as opposed to an in-band tool error result).
 */
export class JSONRPCError extends Error {
  readonly code: number
  readonly data: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'JSONRPCError'
    this.code = code
    this.data = data
  }

  toJSON(): JSONRPCErrorObject {
    return this.data !== undefined
      ? { code: this.code, message: this.message, data: this.data }
      : { code: this.code, message: this.message }
  }
}

/**
 * Map an error thrown by a resource/prompt handler to a JSON-RPC protocol
 * error (these planes don't have an in-band "isError" result like tools do).
 */
export function orpcErrorToJSONRPCError(error: unknown): JSONRPCError {
  if (error instanceof JSONRPCError) {
    return error
  }

  const orpcError = toORPCError(error)
  // `.code` is a runtime-preserved string; its static type is narrowed by toORPCError.
  const code: string = orpcError.code
  const jsonRpcCode = code === 'NOT_FOUND'
    ? RESOURCE_NOT_FOUND
    : code === 'BAD_REQUEST' || code === 'INPUT_VALIDATION_FAILED'
      ? INVALID_PARAMS
      : INTERNAL_ERROR

  return new JSONRPCError(jsonRpcCode, orpcError.message, orpcError.toJSON())
}
