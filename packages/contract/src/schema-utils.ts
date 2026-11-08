import type { IsEqual, Promisable } from '@orpc/shared'
import { isPropertyKey, isNonPrimitive, mergeTwoLevels, ORPC_NAME } from '@orpc/shared'

import type { AnySchema, Schema, SchemaIssue } from './schema.ts'

export type TypeRest<TInput, TOutput> =
  | [map: (input: TInput) => Promisable<TOutput>]
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
          return { value: (await map(value as TInput)) as TOutput }
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
  if (!isNonPrimitive(issue) || typeof issue.message !== 'string') {
    return false
  }

  if (issue.path !== undefined) {
    if (!Array.isArray(issue.path)) {
      return false
    }

    if (
      !issue.path.every(
        (segment) =>
          isPropertyKey(segment) || (isNonPrimitive(segment) && isPropertyKey(segment.key)),
      )
    ) {
      return false
    }
  }

  return true
}

export interface ValidateInputSchemasOptions {
  /**
   * Index of the first schema to run, for validating the schemas in segments.
   *
   * @default 0
   */
  from?: number | undefined
  /**
   * Index after the last schema to run.
   *
   * @default schemas.length
   */
  to?: number | undefined
  /**
   * What the schemas before `from` returned. Only read when `from` is greater than 0.
   */
  current?: unknown
  /**
   * Runs one schema, for example to wrap each validation in a tracing span.
   * It may throw instead of returning issues.
   *
   * @default schema['~standard'].validate(value)
   */
  validate?:
    | ((
        schema: AnySchema,
        value: unknown,
        index: number,
      ) => ReturnType<AnySchema['~standard']['validate']>)
    | undefined
}

export type ValidateInputSchemasResult =
  | { value: unknown; issues?: undefined }
  | {
      issues: readonly SchemaIssue[]
      /**
       * The value the failing schema validated.
       */
      invalidData: unknown
    }

/**
 * Returns the value the stacked `.input` schema at `index` validates: the original input with what
 * the earlier schemas returned (`current`) applied. Only plain objects are merged, two levels deep;
 * anything else is piped.
 */
export function getInputSchemaValue(input: unknown, current: unknown, index: number): unknown {
  return index !== 0 ? mergeTwoLevels(input, current) : current
}

const validateSchema: NonNullable<ValidateInputSchemasOptions['validate']> = (schema, value) =>
  schema['~standard'].validate(value)

/**
 * Validates an input against stacked `.input` schemas.
 *
 * Each schema after the first validates the original input with the results so far applied, then
 * its result is merged in, so no schema loses a field an earlier one stripped and earlier transforms
 * carry through. Only plain objects are merged, two levels deep; anything else, like
 * `asyncIteratorObject`, is piped: each schema validates what the previous one returned.
 *
 * Stops at the first schema that returns issues.
 *
 * @see {@link https://orpc.dev/docs/procedure#multiple-schemas | Procedure - Multiple Schemas}
 */
export async function validateInputSchemas(
  schemas: readonly AnySchema[],
  input: unknown,
  options: ValidateInputSchemasOptions = {},
): Promise<ValidateInputSchemasResult> {
  const from = options.from ?? 0
  const to = options.to ?? schemas.length
  const validate = options.validate ?? validateSchema

  let current = from === 0 ? input : options.current

  for (let index = from; index < to; index++) {
    const value = getInputSchemaValue(input, current, index)
    const result = await validate(schemas[index]!, value, index)

    if (result.issues) {
      return { issues: result.issues, invalidData: value }
    }

    current = index !== 0 ? mergeTwoLevels(current, result.value) : result.value
  }

  return { value: current }
}
