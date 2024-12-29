import type { Schema } from '@orpc/contract'
import type { JSONSchema } from './schema'

export interface SchemaConvertOptions {
  strategy: 'input' | 'output'
}

export interface SchemaConverter {
  condition: (schema: Schema, options: SchemaConvertOptions) => boolean

  convert: (schema: Schema, options: SchemaConvertOptions) => JSONSchema.JSONSchema
}

export class CompositeSchemaConverter implements SchemaConverter {
  private readonly converters: SchemaConverter[]

  constructor(converters: SchemaConverter[]) {
    this.converters = converters
  }

  condition(): boolean {
    return true
  }

  convert(schema: Schema, options: SchemaConvertOptions): JSONSchema.JSONSchema {
    for (const converter of this.converters) {
      if (converter.condition(schema, options)) {
        return converter.convert(schema, options)
      }
    }

    return {} // ANY SCHEMA
  }
}
