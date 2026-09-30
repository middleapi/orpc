import type { IsEqual, Promisable } from '@orpc/shared'
import type { AnySchema, Schema, SchemaIssue } from './schema'
import { isPropertyKey, isTypescriptObject, mergeDeep, ORPC_NAME } from '@orpc/shared'

export type TypeRest<TInput, TOutput>
  = | [map: (input: TInput) => Promisable<TOutput>]
    | (IsEqual<TInput, TOutput> extends true ? [] : never)

/**
 * Create a schema for things can be trust without validation.
 * You can optionally pass a map function for mapping
 *
 * @example
 * ```ts
 * const normal = type<number>()
 * const withMap = type<number, string>(input => input.toString())
 *```
 *
 * @see {@link https://orpc.dev/docs/procedure#type-utility | Procedure - type Utility}
 */
export function type<TInput, TOutput = TInput>(
  ...[map]: TypeRest<TInput, TOutput>
): Schema<TInput, TOutput> {
  return {
    '~standard': {
      vendor: ORPC_NAME,
      version: 1,
      async validate(value) {
        if (map) {
          return { value: await map(value as TInput) as TOutput }
        }

        return { value: value as TOutput }
      },
    },
  }
}

/**
 * Check if the given issue is following the standard-schema issue format.
 */
export function isSchemaIssue(issue: unknown): issue is SchemaIssue {
  if (!isTypescriptObject(issue) || typeof issue.message !== 'string') {
    return false
  }

  if (issue.path !== undefined) {
    if (!Array.isArray(issue.path)) {
      return false
    }

    if (
      !issue.path.every(segment => isPropertyKey(segment) || (isTypescriptObject(segment) && isPropertyKey(segment.key)))
    ) {
      return false
    }
  }

  return true
}

export interface ValidateStackedInputOptions {
  /**
   * Index of the first schema to validate.
   *
   * @default 0
   */
  start?: number

  /**
   * Index after the last schema to validate.
   *
   * @default schemas.length
   */
  end?: number

  /**
   * What the schemas before `start` returned.
   *
   * @default input
   */
  validated?: unknown
}

/**
 * Validates an input against stacked `.input` schemas with `validate`, which returns one schema's
 * result or throws on issues. Each schema after the first validates the input with the results so far
 * merged over it, so no schema loses a field an earlier one stripped and earlier transforms carry through.
 *
 * @remarks
 * **Note**: Merging follows `mergeDeep`, so values that are not plain objects or arrays of the same
 * length are piped, which keeps schemas like `asyncIteratorObject` wrapping each other.
 *
 * @see {@link https://orpc.dev/docs/procedure#multiple-schemas | Procedure - Multiple Schemas}
 */
export async function validateStackedInput(
  schemas: readonly AnySchema[],
  input: unknown,
  validate: (schema: AnySchema, value: unknown, index: number) => Promisable<unknown>,
  options: ValidateStackedInputOptions = {},
): Promise<unknown> {
  const { start = 0, end = schemas.length } = options
  let validated = 'validated' in options ? options.validated : input

  for (let index = start; index < end; index++) {
    const result = await validate(schemas[index]!, index === 0 ? validated : mergeDeep(input, validated), index)

    validated = index === 0 ? result : mergeDeep(validated, result)
  }

  return validated
}
