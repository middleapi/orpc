import type { Writable } from '@orpc/shared'
import type { StandardResponse } from '@standard-server/core'
import type { AnyORPCError, MalformedResponseErrorOptions, ORPCErrorCode, ORPCErrorJSON } from './error'
import { isPlainObject } from '@orpc/shared'
import { COMMON_ERROR_STATUS_MAP, MalformedResponseError, ORPCError } from './error'

/**
 * Checks if an error is an `ORPCError` that matches a definition in the procedure's `.errors` map,
 * narrowing it so `code` and `data` are fully typed.
 *
 * @see {@link https://orpc.dev/docs/client/error-handling#using-safe-and-isdefinederror | Client Error Handling - Using safe and isDefinedError}
 */
export function isDefinedError<T>(error: T): error is Extract<T, AnyORPCError> {
  return error instanceof ORPCError && error.defined
}

export function toORPCError<T>(error: T): Extract<T, AnyORPCError> | ORPCError<'INTERNAL_SERVER_ERROR', undefined> {
  return error instanceof ORPCError
    ? error
    : new ORPCError('INTERNAL_SERVER_ERROR', { cause: error })
}

export function isORPCErrorJson(json: unknown): json is ORPCErrorJSON<ORPCErrorCode, unknown> {
  if (!isPlainObject(json)) {
    return false
  }

  const validKeys = ['defined', 'code', 'message', 'data']
  if (Object.keys(json).some(k => !validKeys.includes(k))) {
    return false
  }

  return 'defined' in json
    && typeof json.defined === 'boolean'
    && 'code' in json
    && typeof json.code === 'string'
    && 'message' in json
    && typeof json.message === 'string'
}

export function createORPCErrorFromJson<TCode extends ORPCErrorCode, TData>(
  json: ORPCErrorJSON<TCode, TData>,
  options: ErrorOptions = {},
): ORPCError <TCode, TData> {
  const error = new ORPCError(json.code, {
    ...json,
    ...options,
  })

  ;(error.defined as Writable<typeof error.defined>) = json.defined

  return error
}

/**
 * Creates the `MALFORMED_ORPC_RESPONSE` `ORPCError` used when a response
 * does not follow the expected oRPC format. Unless overridden via `options.message`,
 * the message is inferred from the response body or status. The `cause` is a
 * `MalformedResponseError` carrying the resolved response.
 *
 * @see {@link https://orpc.dev/docs/rpc/link#malformed-responses | RPC Link - Malformed Responses}
 * @see {@link https://orpc.dev/docs/openapi/link#malformed-responses | OpenAPI Link - Malformed Responses}
 */
export function createORPCErrorFromMalformedResponse(options: MalformedResponseErrorOptions): ORPCError<'MALFORMED_ORPC_RESPONSE', StandardResponse> {
  const error = new ORPCError('MALFORMED_ORPC_RESPONSE', {
    message: options.message ?? inferMalformedResponseMessage(options.response),
    data: options.response,
  })

  error.cause = new MalformedResponseError({ ...options, message: error.message })

  return error
}

/**
 * Bounds for using a body string as the error message,
 * ignoring empty and unreasonably long values.
 */
const INFERRED_MESSAGE_MIN_LENGTH = 1
const INFERRED_MESSAGE_MAX_LENGTH = 256

function isInferableMessage(text: string): boolean {
  return text.length >= INFERRED_MESSAGE_MIN_LENGTH && text.length <= INFERRED_MESSAGE_MAX_LENGTH
}

function inferMalformedResponseMessage(response: StandardResponse): string | undefined {
  if (typeof response.body === 'string' && isInferableMessage(response.body)) {
    return response.body
  }

  if (isPlainObject(response.body) && typeof response.body.message === 'string' && isInferableMessage(response.body.message)) {
    return response.body.message
  }

  const commonCode = Object.entries(COMMON_ERROR_STATUS_MAP).find(([, status]) => status === response.status)?.[0]

  return commonCode?.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ')
}

/**
 * Clones an `ORPCError` while preserving its prototype chain, so instances of
 * `ORPCError` subclasses remain `instanceof` their class.
 *
 * Limitation: subclass constructors are not re-run, so private fields
 * (`#field`) are not carried over and subclass members that read them
 * will throw on the clone.
 */
export function cloneORPCError<T extends AnyORPCError>(error: T): T {
  const cloned = new ORPCError(error.code, {
    message: error.message,
    data: error.data,
    cause: error.cause,
  })

  Object.setPrototypeOf(cloned, Object.getPrototypeOf(error))
  Object.defineProperties(cloned, Object.getOwnPropertyDescriptors(error))
  cloned.stack = error.stack

  return cloned as T
}
