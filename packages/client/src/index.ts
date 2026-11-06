export * from './async-iterator-object.ts'
export * from './client.ts'
export * from './client-safe.ts'
export * from './consts.ts'
export * from './dynamic-link.ts'
export * from './error.ts'
export * from './error-utils.ts'
export * from './rpc-json-serializer.ts'
export * from './rpc-serializer.ts'
export * from './types.ts'
export type {
  /**
   * @deprecated Use `InferClientError` instead.
   */
  InferClientError as InferClientErrorUnion,
} from './types.ts'
export { resolveClientRest, safe } from './utils.ts'
export type { SafeResult } from './utils.ts'

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
  /**
   * @deprecated Use `PromiseWithError` instead.
   */
  PromiseWithError as ClientPromiseResult,
} from '@orpc/shared'

export type {
  EventMeta,
  StandardBody,
  StandardBodyHint,
  StandardHeaders,
  StandardLazyRequest,
  StandardLazyResponse,
  StandardMethod,
  StandardRequest,
  StandardResponse,
  StandardUrl,
} from '@standard-server/core'

export {
  /**
   * @deprecated Use `EventStreamErrorEvent` instead.
   */
  EventStreamErrorEvent as ErrorEvent,
  EventStreamErrorEvent,
  /**
   * Retrieves event metadata (such as the event id and retry interval)
   * attached to a single iterator event value.
   *
   * @see {@link https://orpc.dev/docs/client/async-iterator-object#event-metadata | AsyncIteratorObject in Client - Event Metadata}
   */
  getEventMeta,
  unwrapEvent,
  withEventMeta,
} from '@standard-server/core'
