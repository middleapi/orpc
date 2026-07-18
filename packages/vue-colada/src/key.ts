import type { PartialDeep } from '@orpc/shared'
import type { EntryKey } from '@pinia/colada'
import { RPCJsonSerializer } from '@orpc/client'

export type OperationType = 'query' | 'mutation'

export interface BuildKeyOptions<TInput> {
  type?: OperationType
  input?: PartialDeep<TInput>
}

const serializer = new RPCJsonSerializer()

/**
 * Build a Pinia Colada entry key for a procedure.
 *
 * The input is serialized to JSON-compatible values because Pinia Colada
 * requires entry keys to be serializable.
 *
 * @see {@link https://orpc.dev/docs/integrations/pinia-colada#query-mutation-key Pinia Colada Query/Mutation Key Docs}
 */
export function buildKey<TInput>(
  path: string[],
  options: BuildKeyOptions<TInput> = {},
): EntryKey {
  return [
    path,
    {
      ...options.input !== undefined ? { input: serializer.serialize(options.input).json } : {},
      ...options.type !== undefined ? { type: options.type } : {},
    },
  ] as EntryKey
}
