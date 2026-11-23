export type { OperationKey, OperationKeyOptions, OperationKeyPrefixOptions } from './key'
export { ProcedureUtils } from './procedure-utils'
export type { ProcedureUtilsOptions } from './procedure-utils'
export * from './router-utils'
export { createRouterUtils as createSWRUtils } from './router-utils'
export { SharedUtils } from './shared-utils'
export * from './types'
export {
  /**
   * @deprecated Use `SWR_OPERATION_CONTEXT_SYMBOL` instead.
   */
  OPERATION_CONTEXT_SYMBOL,
  OPERATION_CONTEXT_SYMBOL as SWR_OPERATION_CONTEXT_SYMBOL,
  /**
   * @deprecated Use `SWROperationContext` instead.
   */
  type OperationContext,
  type OperationContext as SWROperationContext,
} from './types'

export type { Public } from '@orpc/shared'
