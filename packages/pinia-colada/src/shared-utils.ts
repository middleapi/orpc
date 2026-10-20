import type { OperationKey, OperationKeyOptions, OperationKeyPrefixOptions, OperationKeySerializerOptions } from './key'
import type { OperationType } from './types'
import { generateOperationKey } from './key'

export class SharedUtils<TInput> {
  constructor(
    protected readonly path: string[],
    protected readonly options: OperationKeyPrefixOptions & OperationKeySerializerOptions,
  ) {}

  /**
   * Generate a **partial matching** key for actions like revalidating queries, checking mutation status, etc.
   *
   * @see {@link https://orpc.dev/docs/integrations/pinia-colada#querymutation-key | Pinia Colada Integration - Query/Mutation Key}
   */
  key<TType extends OperationType>(options: Omit<OperationKeyOptions<TType, TInput>, 'prefix' | 'serializer'> = {}): OperationKey<TType, TInput> {
    return generateOperationKey(this.path, { ...options, prefix: this.options.prefix, serializer: this.options.serializer })
  }
}
