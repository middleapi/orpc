import type { IsEqual, Promisable } from '@orpc/shared'
import type { AnySchema, Schema, SchemaIssue } from './schema'
import { isPropertyKey, isTypescriptObject, mergeTwoLevels, ORPC_NAME } from '@orpc/shared'

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
   * Validates one schema, for example to trace it or to throw on issues.
   *
   * @default (schema, value) => schema['~standard'].validate(value)
   */
  validate?: (schema: AnySchema, value: unknown, index: number) => ReturnType<AnySchema['~standard']['validate']>
}

export type StackedInputValidationResult
  = | { value: unknown, issues?: undefined, invalidData?: undefined }
    | { value?: undefined, issues: readonly SchemaIssue[], invalidData: unknown }

/**
 * Validates an input against the schemas of stacked `.input()` calls, the same way on the server and client.
 *
 * Each schema after the first validates the raw input with the results so far applied, then its result is
 * merged in, so no schema loses a field an earlier one stripped. Values that are not plain objects stay piped,
 * which keeps schemas like `asyncIteratorObject` wrapping each other.
 *
 * @param schemas The schemas of the stacked `.input()` calls, in order.
 * @param input The raw input.
 * @param current The result of the schemas before `options.start`, the raw input when starting from the first one.
 * @param options Which schemas to validate and how.
 * @returns The validated input, or the first issues with the value that was validated.
 */
export async function validateStackedInput(
  schemas: readonly AnySchema[],
  input: unknown,
  current: unknown,
  options: ValidateStackedInputOptions = {},
): Promise<StackedInputValidationResult> {
  const {
    start = 0,
    end = schemas.length,
    validate = (schema, value) => schema['~standard'].validate(value),
  } = options

  for (let index = start; index < end; index++) {
    const validating = index !== 0 ? mergeTwoLevels(input, current) : current
    const result = await validate(schemas[index]!, validating, index)

    if (result.issues) {
      return { issues: result.issues, invalidData: validating }
    }

    current = index !== 0 ? mergeTwoLevels(current, result.value) : result.value
  }

  return { value: current }
}
