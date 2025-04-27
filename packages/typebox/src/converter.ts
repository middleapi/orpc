import type { AnySchema } from '@orpc/contract'
import type { ConditionalSchemaConverter, JSONSchema, SchemaConvertOptions } from '@orpc/openapi'
import { Kind } from '@sinclair/typebox'

// TypeBox schemas are essentially JSON Schemas, so no specific conversion options are needed yet.
export interface experimental_TypeBoxToJsonSchemaConverterOptions {}

export class experimental_TypeBoxToJsonSchemaConverter implements ConditionalSchemaConverter {
  constructor(_options: experimental_TypeBoxToJsonSchemaConverterOptions = {}) {
    // No options currently needed
  }

  condition(schema: AnySchema | undefined): boolean {
    return schema !== undefined && typeof schema === 'object' && Kind in schema
  }

  convert(schema: AnySchema | undefined, _options: SchemaConvertOptions): [required: boolean, jsonSchema: Exclude<JSONSchema, boolean>] {
    // TypeBox schema objects are directly usable as JSON Schema
    return [true, { ...schema } as any]
  }
}
