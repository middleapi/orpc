import type { Writable } from '@orpc/shared'
import type { AnyORPCError, ORPCErrorCode, ORPCErrorJSON } from './error'
import { isPlainObject } from '@orpc/shared'
import { ORPCError } from './error'

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

export function cloneORPCError<T extends ORPCErrorCode, TData>(error: ORPCError<T, TData>): ORPCError<T, TData> {
  const cloned = new ORPCError(error.code, {
    ...error,
    message: error.message,
    data: error.data,
    cause: error.cause,
  })

  cloned.stack = error.stack
  ;(cloned.defined as Writable<typeof cloned.defined>) = error.defined
  ;(cloned.inferable as Writable<typeof cloned.inferable>) = error.inferable

  return cloned
}
