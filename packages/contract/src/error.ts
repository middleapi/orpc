import type { ORPCError, ORPCErrorCode } from '@orpc/client'
import type { AnySchema, InferSchemaOutput, Schema, SchemaIssue } from './schema'

export interface ErrorMapItem<TDataSchema extends AnySchema> {
  message?: string
  data?: TDataSchema
}

export type ErrorMap = {
  [key in ORPCErrorCode]?: ErrorMapItem<AnySchema>
}

export type ORPCErrorFromErrorMap<TErrorMap extends ErrorMap> = {
  [K in keyof TErrorMap]: K extends string
    ? TErrorMap[K] extends ErrorMapItem<infer TDataSchema extends Schema<unknown>>
      ? ORPCError<K, InferSchemaOutput<TDataSchema>>
      : never
    : never
}[keyof TErrorMap]

export interface ValidationErrorOptions extends ErrorOptions {
  message: string
  issues: readonly SchemaIssue[]
  invalidData: unknown
}

export class ValidationError extends Error {
  /**
   * This array is readonly because the upstream Standard Schema returns readonly issues.
   */
  issues: readonly SchemaIssue[]
  invalidData: unknown

  constructor(options: ValidationErrorOptions) {
    super(options.message, options)

    this.issues = options.issues
    this.invalidData = options.invalidData
  }
}
