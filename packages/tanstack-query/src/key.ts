import type { PartialDeep, Public } from '@orpc/shared'
import type { SerializableStreamedQueryOptions } from './stream-query'
import type { OperationType } from './types'
import { RPCJsonSerializer } from '@orpc/client'
import { stringifyJSON } from '@orpc/shared'
import { skipToken } from '@tanstack/query-core'

export interface OperationKeyPrefixOptions {
  /**
   * Prepended as the first element of the key when present.
   * Use this to avoid key conflicts when multiple router utils share the same client.
   */
  prefix?: string | undefined
}

export interface OperationKeyBaseOptions extends OperationKeyPrefixOptions {
  /**
   * Serializes inputs into JSON-compatible values when building keys,
   * and compares custom types in structural sharing.
   * Pass the serializer your link uses so custom types are supported.
   *
   * @default new RPCJsonSerializer()
   */
  serializer?: Public<RPCJsonSerializer> | undefined
}

export type OperationKeyOptions<TType extends OperationType, TInput> = OperationKeyBaseOptions & {
  type?: TType | undefined
  input?: (TType extends 'mutation' ? never : PartialDeep<TInput>) | undefined
  fnOptions?: (TType extends 'streamed' ? SerializableStreamedQueryOptions : never) | undefined
}

type OperationKeyContent<TType extends OperationType, TInput> = Omit<OperationKeyOptions<TType, TInput>, keyof OperationKeyBaseOptions> & {
  /**
   * Set in place of `input` when the operation is disabled with `skipToken`,
   * because query key hashers drop symbols.
   */
  skipToken?: TType extends 'mutation' ? never : true

  /**
   * Serializer types of non-JSON values in `input`, keyed by their JSON-encoded path,
   * so inputs with the same JSON form (like a `Date` and its ISO string) produce different keys.
   * Keyed by path (not a list) so partial keys still match.
   */
  inputMeta?: Record<string, string[]> | undefined
}

export type OperationKey<TType extends OperationType, TInput>
  = | [path: string[], options: OperationKeyContent<TType, TInput>]
    | [prefix: string, path: string[], options: OperationKeyContent<TType, TInput>]

const defaultSerializer = new RPCJsonSerializer()

/**
 * Generate a TanStack Query key for a procedure.
 *
 * The input is serialized to JSON-compatible values, so keys hash and partially match
 * by value, including types like `Date`, `Set`, `Map` and custom serializer types.
 *
 * @see {@link https://orpc.dev/docs/integrations/tanstack-query#key-serializer | TanStack Query Integration - Key Serializer}
 */
export function generateOperationKey<TType extends OperationType, TInput>(
  path: string[],
  options: OperationKeyOptions<TType, TInput> = {},
): OperationKey<TType, TInput> {
  return [
    ...options.prefix !== undefined ? [options.prefix] : [],
    path,
    {
      ...options.input === skipToken
        ? { skipToken: true }
        : options.input !== undefined ? serializeInput(options.serializer ?? defaultSerializer, options.input) : {},
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
