export * from './contract-utils'
export type {
  OperationKey,
  OperationKeyBaseOptions,
  OperationKeyOptions,
  OperationKeyPrefixOptions,
} from './key'
export * from './meta'
export type { RouterUtilsPlugin } from './plugin'
export { mergeProcedureUtilsOptions } from './procedure-utils'
export type {
  ProcedureUtils,
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
export { createRouterUtils, createRouterUtils as createTanstackQueryUtils } from './router-utils'
export type {
  RouterUtils,
  RouterUtilsInternal,
  RouterUtilsOptions,
  RouterUtilsScoped,
  RouterUtilsScopedInternal,
} from './router-utils'
export type { SharedUtils } from './shared-utils'
export * from './ssr'
export type { SerializableStreamedQueryOptions, SettleOnFirstDataOptions } from './stream-query'
export * from './structural-sharing'
export {
  /**
   * @deprecated Use `TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL` instead.
   */
  OPERATION_CONTEXT_SYMBOL,
  OPERATION_CONTEXT_SYMBOL as TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL,
} from './types'
export type {
  /**
   * @deprecated Use `TanstackQueryOperationContext` instead.
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
  QueryKeyOptions,
  QueryOptionsIn,
  QueryOptionsOut,
  StreamedKeyOptions,
  StreamedOptionsIn,
  StreamedOptionsOut,
  OperationContext as TanstackQueryOperationContext,
} from './types'

export type { AnyNestedClient } from '@orpc/client'

export type { Public } from '@orpc/shared'
