import { isAsyncIteratorObject, isTypescriptObject } from '@orpc/shared'

/**
 * Whether a request body or input is a stream or async iterator.
 * These are consumed by the first attempt and cannot be resent.
 */
export function isStreamBody(body: unknown): boolean {
  return body instanceof ReadableStream || isAsyncIteratorObject(body)
}

/**
 * Whether an input is, or directly contains (e.g. the `body` field of a detailed input),
 * a stream or async iterator, so it cannot be resent once a call has started.
 */
export function isStreamInput(input: unknown): boolean {
  if (isStreamBody(input)) {
    return true
  }

  if (!isTypescriptObject(input)) {
    return false
  }

  return Object.values(input).some(isStreamBody)
}
