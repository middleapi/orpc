import type { IsEqual, Promisable } from '@orpc/shared'
// eslint-disable-next-line no-restricted-imports
import type { StandardSchemaV1 } from '@standard-schema/spec'

export type Schema<TInput, TOutput> = StandardSchemaV1<TInput, TOutput>

export type AnySchema = Schema<any, any>

export type SchemaIssue = StandardSchemaV1.Issue

export type InferSchemaInput<T extends AnySchema> = T extends StandardSchemaV1<infer UInput, any> ? UInput : never

export type InferSchemaOutput<T extends AnySchema> = T extends StandardSchemaV1<any, infer UOutput> ? UOutput : never

export type TypeRest<TInput, TOutput>
  = | [map: (input: TInput) => Promisable<TOutput>]
    | (IsEqual<TInput, TOutput> extends true ? [] : never)

/**
 * The schema for things can be trust without validation.
 * If the TInput and TOutput are different, you need pass a map function.
 *
 * @see {@link https://orpc.unnoq.com/docs/procedure#type-utility Type Utility Docs}
 */
export function type<TInput, TOutput = TInput>(...[map]: TypeRest<TInput, TOutput>): Schema<TInput, TOutput> {
  return {
    '~standard': {
      vendor: 'custom',
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
