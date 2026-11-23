export * from './contract-utils'
export type {
  OperationKey,
  OperationKeyBaseOptions,
  OperationKeyOptions,
  OperationKeyPrefixOptions,
} from './key'
export * from './meta'
export type { RouterUtilsPlugin } from './plugin'
export { mergeProcedureUtilsOptions, ProcedureUtils } from './procedure-utils'
export type {
  ProcedureUtilsInfiniteInterceptor,
  ProcedureUtilsInfiniteInterceptorOptions,
  ProcedureUtilsLiveInterceptor,
  ProcedureUtilsLiveInterceptorOptions,
  ProcedureUtilsModifier,
  ProcedureUtilsMutationInterceptor,
  ProcedureUtilsMutationInterceptorOptions,
  ProcedureUtilsOptions,
  ProcedureUtilsQueryInterceptor,
  ProcedureUtilsQueryInterceptorOptions,
  ProcedureUtilsStreamedInterceptor,
  ProcedureUtilsStreamedInterceptorOptions,
} from './procedure-utils'
export {
  /**
   * @deprecated Use `createPiniaColadaUtils` instead.
   */
  createRouterUtils as createORPCVueColadaUtils,
} from './router-utils'
export { createRouterUtils, createRouterUtils as createPiniaColadaUtils } from './router-utils'
export type {
  RouterUtils,
  RouterUtilsInternal,
  RouterUtilsOptions,
  RouterUtilsScoped,
  RouterUtilsScopedInternal,
} from './router-utils'
export { SharedUtils } from './shared-utils'
export * from './ssr'
export type { SerializableStreamedQueryOptions, SettleOnFirstDataOptions } from './stream-query'
export {
  /**
   * @deprecated Use `PINIA_COLADA_OPERATION_CONTEXT_SYMBOL` instead.
   */
  OPERATION_CONTEXT_SYMBOL,
  OPERATION_CONTEXT_SYMBOL as PINIA_COLADA_OPERATION_CONTEXT_SYMBOL,
} from './types'
export type {
  /**
   * @deprecated Use `PiniaColadaOperationContext` instead.
   */
  OperationContext,
} from './types'
export type {
  InferLiveQueryOutput,
  InferStreamedQueryOutput,
  InfiniteKeyOptions,
  InfiniteOptionsIn,
  InfiniteOptionsOut,
  LiveOptionsIn,
  MutationKeyOptions,
  MutationOptionsIn,
  MutationOptionsOut,
  OperationType,
  OperationContext as PiniaColadaOperationContext,
  QueryKeyOptions,
  QueryOptionsIn,
  QueryOptionsOut,
  StreamedKeyOptions,
  StreamedOptionsIn,
  StreamedOptionsOut,
  UseMutationFnContext,
  UseQueryFnContext,
} from './types'

export type { AnyNestedClient } from '@orpc/client'

export type { Public } from '@orpc/shared'
