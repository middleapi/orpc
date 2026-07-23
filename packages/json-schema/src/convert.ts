import type { AnySchema } from '@orpc/contract'
import type { JsonSchema } from './types'

export type JsonSchemaConverterDirection = 'input' | 'output'

export interface JsonSchemaConverter {
  /**
   * Determines whether this converter can handle the given schema.
   */
  condition(schema: AnySchema | undefined, direction: JsonSchemaConverterDirection): boolean

  /**
   * Converts an ORPC schema to a JSON Schema representation.
   */
  convert(schema: AnySchema | undefined, direction: JsonSchemaConverterDirection): [jsonSchema: JsonSchema, optional: boolean]
}

export class DelegatingJsonSchemaConverter implements Pick<JsonSchemaConverter, 'convert'> {
  constructor(
    private readonly converters: JsonSchemaConverter[] = [],
  ) {}

  convert(schema: AnySchema | undefined, direction: JsonSchemaConverterDirection): [jsonSchema: JsonSchema, optional: boolean] {
    for (const converter of this.converters) {
      if (converter.condition(schema, direction)) {
        return converter.convert(schema, direction)
      }
    }

    const result = schema?.['~standard'].validate(undefined)
    const optional = result instanceof Promise ? false : !result?.issues?.length

    if (schema && 'jsonSchema' in schema['~standard'] && schema['~standard'].jsonSchema) {
      try {
        return [
          (schema['~standard'].jsonSchema as any)[direction](),
          optional,
        ]
      }
      catch { }
    }

    return [{}, optional]
  }
}
