import type { PartialDeep, Public } from '@orpc/shared'
import type { EntryKey } from '@pinia/colada'
import type { SerializableStreamedQueryOptions } from './stream-query'
import type { OperationType } from './types'
import { RPCJsonSerializer } from '@orpc/client'
import { stringifyJSON } from '@orpc/shared'

export interface OperationKeyPrefixOptions {
  /**
   * Prepended as the first element of the key when present.
   * Use this to avoid key conflicts when multiple router utils share the same client.
   */
  prefix?: string | undefined
}

export interface OperationKeyBaseOptions extends OperationKeyPrefixOptions {
  /**
   * Serializes inputs into JSON-compatible values when building keys.
   * Pass the serializer your link uses so custom types produce consistent keys.
   *
   * @default new RPCJsonSerializer()
   */
  serializer?: Public<RPCJsonSerializer> | undefined
}

export type OperationKeyOptions<TType extends OperationType, TInput> = OperationKeyBaseOptions & {
  type?: TType | undefined
  input?: PartialDeep<TInput> | undefined
  fnOptions?: (TType extends 'streamed' ? SerializableStreamedQueryOptions : never) | undefined
}

type OperationKeyContent<TType extends OperationType, TInput> = Omit<OperationKeyOptions<TType, TInput>, keyof OperationKeyBaseOptions> & {
  /**
   * Serializer types of non-JSON values in `input`, keyed by their JSON-encoded path,
   * so inputs with the same JSON form (like a `Date` and its ISO string) produce different keys.
   * Keyed by path (not a list) so partial keys still match.
   */
  inputMeta?: Record<string, string[]> | undefined
}

export type OperationKey<TType extends OperationType, TInput>
  = EntryKey & (
    | [path: string[], options: OperationKeyContent<TType, TInput>]
    | [prefix: string, path: string[], options: OperationKeyContent<TType, TInput>]
  )

const defaultSerializer = /* @__PURE__ */ new RPCJsonSerializer()

/**
 * Generate a Pinia Colada entry key for a procedure.
 *
 * The input is serialized to JSON-compatible values because Pinia Colada
 * requires entry keys to be serializable.
 *
 * @see {@link https://orpc.dev/docs/integrations/pinia-colada#querymutation-key | Pinia Colada Integration - Query/Mutation Key}
 */
export function generateOperationKey<TType extends OperationType, TInput>(
  path: string[],
  options: OperationKeyOptions<TType, TInput> = {},
): OperationKey<TType, TInput> {
  return [
    ...options.prefix !== undefined ? [options.prefix] : [],
    path,
    {
      ...options.input !== undefined ? serializeInput(options.serializer ?? defaultSerializer, options.input) : {},
      ...options.type !== undefined ? { type: options.type } : {},
      ...options.fnOptions !== undefined ? { fnOptions: options.fnOptions } : {},
    },
  ] as OperationKey<TType, TInput>
}

function serializeInput(serializer: Public<RPCJsonSerializer>, input: unknown) {
  const { json, meta } = serializer.serializeJson(input)

  if (!meta?.length) {
    return { input: json }
  }

  const inputMeta: Record<string, string[]> = {}

  for (const [type, ...segments] of meta) {
    (inputMeta[stringifyJSON(segments)] ??= []).push(type)
  }

  return { input: json, inputMeta }
}
