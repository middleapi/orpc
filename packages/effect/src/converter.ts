import type { AnySchema } from '@orpc/contract'
import type { JsonSchema, JsonSchemaConverter, JsonSchemaConverterDirection } from '@orpc/json-schema'
import { Schema as EffectSchema } from 'effect'

export class EffectSchemaToJsonSchemaConverter implements JsonSchemaConverter {
  condition(schema: AnySchema | undefined, _direction: JsonSchemaConverterDirection): boolean {
    return schema?.['~standard'].vendor === 'effect'
  }

  convert(schema: AnySchema | undefined, direction: JsonSchemaConverterDirection): [jsonSchema: JsonSchema, optional: boolean] {
    const effectSchema = schema as EffectSchema.Unknown & AnySchema
    const standardSchema = EffectSchema.toStandardJSONSchemaV1(effectSchema)
    const jsonSchema = direction === 'input'
      ? standardSchema['~standard'].jsonSchema.input({ target: 'draft-2020-12' })
      : standardSchema['~standard'].jsonSchema.output({ target: 'draft-2020-12' })

    let optional = false
    try {
      const result = effectSchema['~standard'].validate(undefined)
      if (!(result instanceof Promise) && !result.issues) {
        optional = direction === 'input' ? true : result.value === undefined
      }
    }
    catch {}

    return [jsonSchema as JsonSchema, optional]
  }
}
