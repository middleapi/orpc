import type { OperationKey, OperationKeyBaseOptions, OperationKeyOptions } from './key'
import type { OperationType } from './types'
import { generateOperationKey } from './key'

export class SharedUtils<TInput> {
  constructor(
    protected readonly path: string[],
    protected readonly options: OperationKeyBaseOptions,
  ) {}

  /**
   * Generate a **partial matching** key for actions like revalidating queries, checking mutation status, etc.
   *
   * @see {@link https://orpc.dev/docs/integrations/pinia-colada#querymutation-key | Pinia Colada Integration - Query/Mutation Key}
   */
  key<TType extends OperationType>(options: Omit<OperationKeyOptions<TType, TInput>, keyof OperationKeyBaseOptions> = {}): OperationKey<TType, TInput> {
    return generateOperationKey(this.path, { ...options, prefix: this.options.prefix, serializer: this.options.serializer })
  }
}
