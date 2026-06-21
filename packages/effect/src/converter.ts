import type { AnySchema } from '@orpc/contract'
import type { JsonSchema, JsonSchemaConverter, JsonSchemaConverterDirection } from '@orpc/json-schema'
import type { Schema as EffectSchema } from 'effect'
import { JSONSchema } from 'effect'

export class EffectSchemaToJsonSchemaConverter implements JsonSchemaConverter {
  condition(schema: AnySchema | undefined, _direction: JsonSchemaConverterDirection): boolean {
    return schema?.['~standard'].vendor === 'effect'
  }

  convert(schema: AnySchema | undefined, direction: JsonSchemaConverterDirection): [jsonSchema: JsonSchema, optional: boolean] {
    const effectSchema = schema as unknown as EffectSchema.Schema<any, any> & AnySchema
    const jsonSchema = JSONSchema.make(effectSchema, { target: 'jsonSchema2020-12' })

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
