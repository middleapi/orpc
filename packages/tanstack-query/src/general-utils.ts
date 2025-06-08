import type { OperationKey, OperationKeyOptions, OperationType } from './types'
import { generateOperationKey } from './key'

/**
 * Utils at any level (procedure or router)
 */
export interface GeneralUtils<TInput> {
  /**
   * Generate a query/mutation key for checking status, invalidate, set, get, etc.
   *
   * @see {@link https://orpc.unnoq.com/docs/integrations/tanstack-query-old/basic#query-mutation-key Tanstack Query/Mutation Key Docs}
   */
  key<TType extends OperationType>(options?: OperationKeyOptions<TType, TInput>): OperationKey<TType, TInput>
}

export function createGeneralUtils<TInput>(path: readonly string[]): GeneralUtils<TInput> {
  return {
    key(options) {
      return generateOperationKey(path, options)
    },
  }
}
