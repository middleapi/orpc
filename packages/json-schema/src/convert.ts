import type { AnySchema } from '@orpc/contract'
import type { Promisable } from '@orpc/shared'
import type { JsonSchema } from './types'

export type JsonSchemaConverterDirection = 'input' | 'output'

export interface JsonSchemaConverter {
  /**
   * Determines whether this converter can handle the given schema.
   */
  condition(schema: AnySchema | undefined, direction: JsonSchemaConverterDirection): Promisable<boolean>

  /**
   * Converts an ORPC schema to a JSON Schema representation.
   */
  convert(schema: AnySchema | undefined, direction: JsonSchemaConverterDirection): Promisable<[jsonSchema: JsonSchema, optional: boolean]>
}

export class DelegatingJsonSchemaConverter implements Pick<JsonSchemaConverter, 'convert'> {
  constructor(
    private readonly converters: JsonSchemaConverter[] = [],
  ) {}

  async convert(schema: AnySchema | undefined, direction: JsonSchemaConverterDirection): Promise<[jsonSchema: JsonSchema, optional: boolean]> {
    for (const converter of this.converters) {
      if (await converter.condition(schema, direction)) {
        return converter.convert(schema, direction)
      }
    }

    const optional = !(await schema?.['~standard'].validate(undefined))?.issues?.length

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
