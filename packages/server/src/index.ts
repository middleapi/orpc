export * from './builder'
export * from './builder-variants'
export * from './constants'
export * from './context'
export * from './implementer'
export * from './implementer-procedure'
export { SharedRouterImplementer } from './implementer-router'
export type {
  RouterImplementer,
  RouterImplementerWithMiddlewares,
  SharedRouterImplementerWithMiddlewares,
} from './implementer-router'
export * from './lazy'
export * from './middleware'
export type { DecoratedMiddleware } from './middleware-decorated'
export * from './procedure'
export * from './procedure-client'
export * from './procedure-decorated'
export { call } from './procedure-utils'
export type { CallOptions, CallRest } from './procedure-utils'
export * from './router'
export type {
  /**
   * @deprecated Use `InferRouterFinalContexts` instead.
   */
  InferRouterFinalContexts as InferRouterCurrentContexts,
} from './router'
export * from './router-client'
export {
  getRouter,
  resolveContractProcedure,
  unlazyRouter,
  walkProcedureContractsAsync,
  walkProcedureContractsSync,
} from './router-utils'
export type {
  AugmentedRouter,
  AugmentedRouterWithMiddlewares,
  UnlaziedRouter,
  WalkProcedureContractsLazyResult,
} from './router-utils'

export type {
  AnyORPCError,
  AnyORPCErrorJSON,
  Client,
  ClientContext,
  ClientOptions,
  ClientRest,
  FriendlyClientOptions,
  HeadersContext,
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
  COMMON_ERROR_STATUS_MAP,
  getRequestHeaders,
  getResponseHeaders,
  isDefinedError,
  ORPCError,
  REQUEST_HEADERS_CONTEXT_SYMBOL,
  RESPONSE_HEADERS_CONTEXT_SYMBOL,
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
  MergedSchema,
  Meta,
  MetaPlugin,
  MetaPluginDefinition,
  ORPCErrorConstructorMap,
  ORPCErrorConstructorMapItem,
  ORPCErrorConstructorMapItemOptions,
  ORPCErrorFactory,
  ORPCErrorFactoryOptions,
  ORPCErrorFromErrorMap,
  ProcedureContract,
  ProcedureContractDefinition,
  RouterContract,
  Schema,
} from '@orpc/contract'

export {
  asyncIteratorObject,
  defineMeta,
  error,
  eventIterator,
  type,
  ValidationError,
} from '@orpc/contract'

export type {
  AsyncCleanupFn,
  AsyncIteratorClassNextFn,
  DistributiveOmit,
  IntersectPick,
  MaybeOptionalOptions,
  PromiseWithError,
  Public,
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
  ErrorEvent,
  /**
   * Retrieves metadata attached to a single iterator event value.
   *
   * @see {@link https://orpc.dev/docs/helpers/publisher | Publisher Helpers}
   */
  getEventMeta,
  unwrapEvent,
  /**
   * Returns a new iterator event value with attached, validated metadata.
   *
   * @see {@link https://orpc.dev/docs/async-iterator-object#last-event-id--event-metadata | AsyncIteratorObject (SSE) - Last Event ID & Event Metadata}
   */
  withEventMeta,
} from '@standard-server/core'
