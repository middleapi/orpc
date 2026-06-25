import type { AnySchema } from '@orpc/contract'
import type { JsonSchema, JsonSchemaConverter, JsonSchemaConverterDirection } from '@orpc/json-schema'
import { StandardJsonSchemaConverter } from '@orpc/json-schema'
import { Schema as EffectSchema } from 'effect'

const standardJsonSchemaConverter = new StandardJsonSchemaConverter()
export class EffectSchemaToJsonSchemaConverter implements JsonSchemaConverter {
  condition(schema: AnySchema | undefined, _direction: JsonSchemaConverterDirection): boolean {
    return schema?.['~standard'].vendor === 'effect'
  }

  convert(schema: AnySchema | undefined, direction: JsonSchemaConverterDirection): [jsonSchema: JsonSchema, optional: boolean] {
    const effectSchema = schema as EffectSchema.Constraint & AnySchema
    const standardJsonSchema = EffectSchema.toStandardJSONSchemaV1(effectSchema)

    return standardJsonSchemaConverter.convert(standardJsonSchema, direction)
  }
}
