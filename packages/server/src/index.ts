export * from './builder'
export * from './builder-variants'
export * from './constants'
export * from './context'
export * from './error'
export * from './implementer'
export * from './implementer-procedure'
export * from './implementer-router'
export * from './lazy'
export * from './middleware'
export * from './middleware-decorated'
export * from './procedure'
export * from './procedure-client'
export * from './procedure-decorated'
export * from './procedure-utils'
export * from './router'
export * from './router-client'
export * from './router-hidden'
export * from './router-utils'

export type {
  AnyORPCError,
  AnyORPCErrorJSON,
  Client,
  ClientContext,
  ClientOptions,
  ClientRest,
  FriendlyClientOptions,
  ORPCErrorCode,
  ORPCErrorJSON,
  ORPCErrorOptions,
  RPCJsonSerialization,
  RPCJsonSerializationMeta,
  RPCJsonSerializerHandler,
  RPCJsonSerializerOptions,
  RPCSerializerOptions,
  RPCSerializerSerializeOptions,
  SafeResult,
} from '@orpc/client'

export {
  cloneORPCError,
  COMMON_ERROR_STATUS_MAP,
  isDefinedError,
  isInferableError,
  ORPCError,
  RPCJsonSerializer,
  RPCSerializer,
  safe,
  toORPCError,
} from '@orpc/client'

export type {
  AnyMetaPlugin,
  AnySchema,
  ErrorMap,
  ErrorMapItem,
  InferSchemaInput,
  InferSchemaOutput,
  InitialInputSchema,
  InitialOutputSchema,
  MergedErrorMap,
  Meta,
  MetaPlugin,
  MetaPluginDefinition,
  ORPCErrorFromErrorMap,
  ProcedureContract,
  ProcedureContractDefinition,
  RouterContract,
  Schema,
} from '@orpc/contract'

export {
  asyncIteratorObject,
  defineMeta,
  eventIterator,
  reconcileORPCError,
  type,
  ValidationError,
} from '@orpc/contract'

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
