import type { Writable } from '@orpc/shared'
import type { AnyORPCError, ORPCErrorCode, ORPCErrorJSON } from './error'
import { isPlainObject } from '@orpc/shared'
import { ORPCError } from './error'

/**
 * Checks if an error is an `ORPCError` whose type is inferable at the TypeScript level,
 * narrowing it so `code` and `data` are fully typed.
 *
 * @see {@link https://orpc.dev/docs/client/error-handling#using-safe-and-isinferableerror | Client Error Handling - Using safe and isInferableError}
 */
export function isInferableError<T>(error: T): error is Extract<T, AnyORPCError> {
  return error instanceof ORPCError && error.inferable
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

  const validKeys = ['defined', 'inferable', 'code', 'message', 'data']
  if (Object.keys(json).some(k => !validKeys.includes(k))) {
    return false
  }

  return 'defined' in json
    && typeof json.defined === 'boolean'
    && 'inferable' in json
    && typeof json.inferable === 'boolean'
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
  ;(error.inferable as Writable<typeof error.inferable>) = json.inferable

  return error
}

export function cloneORPCError<T extends AnyORPCError>(error: T): T {
  const cloned = Object.create(Object.getPrototypeOf(error))

  Object.assign(cloned, error)

  cloned.message = error.message
  cloned.stack = error.stack
  cloned.cause = error.cause
  ;(cloned.defined as Writable<typeof cloned.defined>) = error.defined
  ;(cloned.inferable as Writable<typeof cloned.inferable>) = error.inferable

  return cloned
}
