import { isInferableError } from './error-utils'

export * from './client'
export * from './client-safe'
export * from './consts'
export * from './dynamic-link'
export * from './error'
export * from './error-utils'
export * from './event-iterator'
export * from './rpc-json-serializer'
export * from './rpc-serializer'
export * from './types'
export * from './utils'

export type { Registry, ThrowableError } from '@orpc/shared'
export {
  AsyncIteratorClass,
  asyncIteratorToStream as eventIteratorToStream,
  asyncIteratorToUnproxiedDataStream as eventIteratorToUnproxiedDataStream,
  onError,
  onFinish,
  onStart,
  onSuccess,
  streamToAsyncIteratorClass as streamToEventIterator,
} from '@orpc/shared'
export type { AsyncCleanupFn, AsyncIteratorClassNextFn } from '@orpc/shared'
export { ErrorEvent, getEventMeta, unwrapEvent, withEventMeta } from '@standardserver/core'

/**
 * @deprecated Use `isInferableError` instead.
 */
export const isDefinedError = isInferableError
