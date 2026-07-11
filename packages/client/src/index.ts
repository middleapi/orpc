export * from './async-iterator-object'
export * from './client'
export * from './client-safe'
export * from './consts'
export * from './dynamic-link'
export * from './error'
export {
  /**
   * @deprecated Use `isInferableError` instead.
   */
  isInferableError as isDefinedError,
} from './error-utils'
export * from './error-utils'
export * from './rpc-json-serializer'
export * from './rpc-serializer'
export * from './types'
export * from './utils'

export type {
  AsyncCleanupFn,
  AsyncIteratorClassNextFn,
  MaybeOptionalOptions,
  PromiseWithError,
  Registry,
  ThrowableError,
} from '@orpc/shared'

export {
  AsyncIteratorClass,
  asyncIteratorToStream,
  asyncIteratorToUnproxiedDataStream,
  consumeAsyncIterator,
  /**
   * @deprecated Use `consumeAsyncIterator` instead.
   */
  consumeAsyncIterator as consumeEventIterator,
  /**
   * @deprecated Use `asyncIteratorToStream` instead.
   */
  asyncIteratorToStream as eventIteratorToStream,
  /**
   * @deprecated Use `asyncIteratorToUnproxiedDataStream` instead.
   */
  asyncIteratorToUnproxiedDataStream as eventIteratorToUnproxiedDataStream,
  onAsyncIteratorObjectError,
  onError,
  onFinish,
  onReadableStreamError,
  onStart,
  onSuccess,
  streamToAsyncIteratorObject,
  /**
   * @deprecated Use `streamToAsyncIteratorObject` instead.
   */
  streamToAsyncIteratorObject as streamToEventIterator,
} from '@orpc/shared'

export type {
  EventMeta,
} from '@standardserver/core'

export {
  ErrorEvent,
  getEventMeta,
  unwrapEvent,
  withEventMeta,
} from '@standardserver/core'
