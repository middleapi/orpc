import type { AnySchema, JsonSchema, JsonSchemaConverter, JsonSchemaConverterDirection } from '@orpc/json-schema'
import type { ZodType } from 'zod/v4'
import type { $ZodType, ToJSONSchemaParams, JSONSchema as ZodJsonSchema } from 'zod/v4/core'
import { JsonSchemaFormat, JsonSchemaXNativeType } from '@orpc/json-schema'
import { toJSONSchema } from 'zod/v4/core'

export interface ZodToJsonSchemaConverterOptions extends Omit<ToJSONSchemaParams, 'target' | 'io'> {}

export class ZodToJsonSchemaConverter implements JsonSchemaConverter {
  constructor(private readonly options: ZodToJsonSchemaConverterOptions = {}) {
  }

  condition(schema: AnySchema | undefined, _direction: JsonSchemaConverterDirection): boolean {
    return schema?.['~standard'].vendor === 'zod'
  }

  convert(schema: AnySchema | undefined, direction: JsonSchemaConverterDirection): [jsonSchema: JsonSchema, optional: boolean] {
    const zodSchema = schema as $ZodType
    const jsonSchema = this.convertZod(zodSchema, direction)

    let optional = false
    try {
      const result = zodSchema['~standard'].validate(undefined)
      if (!(result instanceof Promise) && !result.issues) {
        optional = direction === 'input' ? true : result.value === undefined
      }
    }
    catch {}

    return [jsonSchema as JsonSchema, optional]
  }

  private convertZod(schema: $ZodType, direction: JsonSchemaConverterDirection): ZodJsonSchema.JSONSchema {
    const jsonSchema = toJSONSchema(schema, {
      unrepresentable: 'any',
      ...this.options,
      target: 'draft-2020-12',
      io: direction,
      override: (ctx) => {
        const def = ctx.zodSchema._zod.def

        if (def.type === 'bigint') {
          ctx.jsonSchema.type = 'string'
          ctx.jsonSchema.pattern = '^-?[0-9]+$'
          ctx.jsonSchema['x-native-type'] = JsonSchemaXNativeType.BigInt
        }
        else if (def.type === 'date') {
          ctx.jsonSchema.type = 'string'
          ctx.jsonSchema.format = JsonSchemaFormat.DateTime
          ctx.jsonSchema['x-native-type'] = JsonSchemaXNativeType.Date
        }
        else if (def.type === 'set') {
          ctx.jsonSchema.type = 'array'
          ctx.jsonSchema.uniqueItems = true
          ctx.jsonSchema.items = this.convertZod(def.valueType, direction)
          ctx.jsonSchema['x-native-type'] = JsonSchemaXNativeType.Set
        }
        else if (def.type === 'map') {
          ctx.jsonSchema.type = 'array'
          ctx.jsonSchema.items = {
            type: 'array',
            prefixItems: [
              this.convertZod(def.keyType, direction),
              this.convertZod(def.valueType, direction),
            ],
            maxItems: 2,
            minItems: 2,
          }
          ctx.jsonSchema['x-native-type'] = JsonSchemaXNativeType.Map
        }

        this.options.override?.(ctx)
      },
    })

    // Since the default oRPC format is always draft/2020-12,
    // `$schema` can be safely omitted here.
    const { $schema, ...rest } = jsonSchema

    try {
      // workaround until https://github.com/colinhacks/zod/issues/6026 is merged
      const { id } = (schema as ZodType).meta() || {}
      if (id) {
        return {
          $ref: `#/$defs/${id}`,
          $defs: {
            [id]: rest,
          },
        }
      }
    }
    catch {}

    return rest
  }
}
