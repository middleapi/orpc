import type { PartialDeep } from '@orpc/shared'
import type { EntryKey } from '@pinia/colada'
import type { OperationType } from './types'
import { RPCJsonSerializer } from '@orpc/client'

export interface BuildKeyPrefixOptions {
  /**
   * Prepended as the first element of the key when present.
   * Use this to avoid key conflicts when multiple router utils share the same client.
   */
  prefix?: string
}

export interface BuildKeyOptions<TInput> extends BuildKeyPrefixOptions {
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
    ...options.prefix !== undefined ? [options.prefix] : [],
    path,
    {
      ...options.input !== undefined ? { input: serializer.serialize(options.input).json } : {},
      ...options.type !== undefined ? { type: options.type } : {},
    },
  ] as EntryKey
}
