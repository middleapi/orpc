export type { OperationKey, OperationKeyOptions, OperationKeyPrefixOptions } from './key'
export type { ProcedureUtils, ProcedureUtilsOptions } from './procedure-utils'
export { createRouterUtils, createRouterUtils as createSWRUtils } from './router-utils'
export type { RouterUtils, RouterUtilsInternal, RouterUtilsOptions } from './router-utils'
export type { SharedUtils } from './shared-utils'
export {
  /**
   * @deprecated Use `SWR_OPERATION_CONTEXT_SYMBOL` instead.
   */
  OPERATION_CONTEXT_SYMBOL,
  OPERATION_CONTEXT_SYMBOL as SWR_OPERATION_CONTEXT_SYMBOL,
} from './types'
export type {
  /**
   * @deprecated Use `SWROperationContext` instead.
   */
  OperationContext,
} from './types'
export type {
  Fetcher,
  FetcherOptions,
  InferLiveSubscriberOutput,
  InferSubscriberOutput,
  KeyOptions,
  Matcher,
  MatcherOptions,
  MatcherStrategy,
  Mutator,
  MutatorOptions,
  OperationType,
  Subscriber,
  SubscriberOptions,
  OperationContext as SWROperationContext,
} from './types'

export type { Public } from '@orpc/shared'
