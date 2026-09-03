import type { AnySchema, JsonSchema, JsonSchemaConverter, JsonSchemaConverterDirection } from '@orpc/json-schema'
import type { $ZodType, ToJSONSchemaParams, JSONSchema as ZodJsonSchema } from 'zod/v4/core'
import { JsonSchemaFormat, JsonSchemaXNativeType } from '@orpc/json-schema'
import { toJSONSchema } from 'zod/v4/core'
import { JSON_SCHEMA_INPUT_REGISTRY, JSON_SCHEMA_OUTPUT_REGISTRY, JSON_SCHEMA_REGISTRY } from './registries'

export interface ZodToJsonSchemaConverterOptions extends Omit<ToJSONSchemaParams, 'target' | 'io'> {
  /**
   * Caches conversion results in a WeakMap keyed by the Zod schema instance,
   * so converting the same schema again is free.
   *
   * When enabled, repeated conversions return the same JSON schema object,
   * so treat returned schemas as immutable.
   *
   * @default false
   */
  cache?: boolean
}

/**
 * Converts Zod schemas into JSON Schema using Zod's built-in `toJSONSchema`,
 * with additional support for types such as `z.bigint()`, `z.date()`, `z.set()`, and `z.map()`.
 *
 * @see {@link https://orpc.dev/docs/integrations/zod | Zod Integration}
 */
export class ZodToJsonSchemaConverter implements JsonSchemaConverter {
  private readonly toJSONSchemaParams: ToJSONSchemaParams
  private readonly cache: undefined | { [d in JsonSchemaConverterDirection]: WeakMap<$ZodType, [jsonSchema: JsonSchema, optional: boolean]> }

  constructor(
    { cache, ...toJSONSchemaParams }: ZodToJsonSchemaConverterOptions = {},
  ) {
    this.toJSONSchemaParams = toJSONSchemaParams

    if (cache) {
      this.cache = { input: new WeakMap(), output: new WeakMap() }
    }
  }

  condition(schema: AnySchema | undefined, _direction: JsonSchemaConverterDirection): boolean {
    return schema?.['~standard'].vendor === 'zod'
  }

  convert(schema: AnySchema | undefined, direction: JsonSchemaConverterDirection): [jsonSchema: JsonSchema, optional: boolean] {
    const zodSchema = schema as $ZodType

    if (this.cache) {
      const cached = this.cache[direction].get(zodSchema)
      if (cached) {
        return cached
      }
    }

    const result = this.convertUncached(zodSchema, direction)

    if (this.cache) {
      this.cache[direction].set(zodSchema, result)
    }

    return result
  }

  private convertUncached(zodSchema: $ZodType, direction: JsonSchemaConverterDirection): [jsonSchema: JsonSchema, optional: boolean] {
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
      ...this.toJSONSchemaParams,
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

        const customJsonSchema = this.getCustomJsonSchema(ctx.zodSchema, direction)

        if (customJsonSchema) {
          Object.assign(ctx.jsonSchema, customJsonSchema)
        }

        this.toJSONSchemaParams.override?.(ctx)
      },
    })

    // Since the default oRPC format is always draft/2020-12,
    // `$schema` can be safely omitted here.
    const { $schema, ...rest } = jsonSchema

    return rest
  }

  private getCustomJsonSchema(schema: $ZodType, direction: JsonSchemaConverterDirection): Exclude<JsonSchema, boolean> | undefined {
    const general = JSON_SCHEMA_REGISTRY.get(schema)
    const directional = direction === 'input'
      ? JSON_SCHEMA_INPUT_REGISTRY.get(schema)
      : JSON_SCHEMA_OUTPUT_REGISTRY.get(schema)

    if (general === undefined && directional === undefined) {
      return undefined
    }

    return { ...general, ...directional } as Exclude<JsonSchema, boolean>
  }
}
