export * from './builder.ts'
export * from './builder-variants.ts'
export * from './constants.ts'
export * from './context.ts'
export * from './implementer.ts'
export * from './implementer-procedure.ts'
export { SharedRouterImplementer } from './implementer-router.ts'
export type {
  RouterImplementer,
  RouterImplementerWithMiddlewares,
  SharedRouterImplementerWithMiddlewares,
} from './implementer-router.ts'
export * from './lazy.ts'
export * from './middleware.ts'
export type { DecoratedMiddleware } from './middleware-decorated.ts'
export * from './procedure.ts'
export * from './procedure-client.ts'
export * from './procedure-decorated.ts'
export { call } from './procedure-utils.ts'
export type { CallOptions, CallRest } from './procedure-utils.ts'
export * from './router.ts'
export type {
  /**
   * @deprecated Use `InferRouterFinalContexts` instead.
   */
  InferRouterFinalContexts as InferRouterCurrentContexts,
} from './router.ts'
export * from './router-client.ts'
export {
  getRouter,
  resolveContractProcedure,
  unlazyRouter,
  walkProcedureContractsAsync,
  walkProcedureContractsSync,
} from './router-utils.ts'
export type {
  AugmentedRouter,
  AugmentedRouterWithMiddlewares,
  UnlaziedRouter,
  WalkProcedureContractsLazyResult,
} from './router-utils.ts'

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
  COMMON_ERROR_STATUS_MAP,
  isDefinedError,
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
