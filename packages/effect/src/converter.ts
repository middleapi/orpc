import type { AnySchema } from '@orpc/contract'
import type { JsonSchema, JsonSchemaConverter, JsonSchemaConverterDirection } from '@orpc/json-schema'
import { StandardJsonSchemaConverter } from '@orpc/json-schema'
import { Schema as EffectSchema } from 'effect'

export class EffectSchemaToJsonSchemaConverter implements JsonSchemaConverter {
  private readonly converter = new StandardJsonSchemaConverter()

  condition(schema: AnySchema | undefined, _direction: JsonSchemaConverterDirection): boolean {
    return schema?.['~standard'].vendor === 'effect'
  }

  convert(schema: AnySchema | undefined, direction: JsonSchemaConverterDirection): [jsonSchema: JsonSchema, optional: boolean] {
    const effectSchema = schema as EffectSchema.Constraint & AnySchema
    const standardJsonSchema = EffectSchema.toStandardJSONSchemaV1(effectSchema)
    return this.converter.convert(standardJsonSchema, direction)
  }
}
