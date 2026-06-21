import type { OperationKey, OperationKeyOptions, OperationType } from './types'

export function generateOperationKey<TType extends OperationType, TInput>(
  path: string[],
  state: OperationKeyOptions<TType, TInput> = {},
): OperationKey<TType, TInput> {
  return [path, {
    ...state.input !== undefined ? { input: state.input } : {},
    ...state.type !== undefined ? { type: state.type } : {},
    ...state.fnOptions !== undefined ? { fnOptions: state.fnOptions } : {},
  } as any]
}
