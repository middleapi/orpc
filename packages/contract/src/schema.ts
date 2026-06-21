// eslint-disable-next-line no-restricted-imports
import type { StandardSchemaV1 } from '@standard-schema/spec'

/**
 * TOutput default = TInput for better readability (shorter) in-case both TInput, TOutput is equal
 */
export type Schema<TInput, TOutput = TInput> = StandardSchemaV1<TInput, TOutput>

export type AnySchema = Schema<any>

export type SchemaIssue = StandardSchemaV1.Issue

export type InferSchemaInput<T extends AnySchema> = T extends StandardSchemaV1<infer UInput, any> ? UInput : never

export type InferSchemaOutput<T extends AnySchema> = T extends StandardSchemaV1<any, infer UOutput> ? UOutput : never

export type MergedSchema<T extends AnySchema, U extends AnySchema>
  = T extends Schema<infer TInput, infer TOutput>
    ? U extends Schema<infer UInput, infer UOutput>
      ? Schema<TInput & UInput, TOutput & UOutput>
      : never
    : never
