import type { PartialDeep } from '@orpc/shared'
import type { SerializableStreamedQueryOptions } from './stream-query'
import type { OperationType } from './types'

export interface OperationKeyPrefixOptions {
  /**
   * Prepended as the first element of the key when present.
   * Use this to avoid key conflicts when multiple router utils share the same client.
   */
  prefix?: string
}

export type OperationKeyOptions<TType extends OperationType, TInput> = OperationKeyPrefixOptions & {
  type?: TType
  input?: TType extends 'mutation' ? never : PartialDeep<TInput>
  fnOptions?: TType extends 'streamed' ? SerializableStreamedQueryOptions : never
}

export type OperationKey<TType extends OperationType, TInput>
  = | [path: string[], options: Omit<OperationKeyOptions<TType, TInput>, 'prefix'>]
    | [prefix: string, path: string[], options: Omit<OperationKeyOptions<TType, TInput>, 'prefix'>]

export function generateOperationKey<TType extends OperationType, TInput>(
  path: string[],
  options: OperationKeyOptions<TType, TInput> = {},
): OperationKey<TType, TInput> {
  return [
    ...options.prefix !== undefined ? [options.prefix] : [],
    path,
    {
      ...options.input !== undefined ? { input: options.input } : {},
      ...options.type !== undefined ? { type: options.type } : {},
      ...options.fnOptions !== undefined ? { fnOptions: options.fnOptions } : {},
    },
  ] as OperationKey<TType, TInput>
}
