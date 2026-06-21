import type { JsonSchema as ArkJsonSchema, ToJsonSchema } from '@ark/schema'
import type { AnySchema, JsonSchema, JsonSchemaConverter, JsonSchemaConverterDirection } from '@orpc/json-schema'
import type { Type } from 'arktype'
import { JsonSchemaFormat, JsonSchemaXNativeType } from '@orpc/json-schema'

export interface ArkTypeToJsonSchemaConverterOptions extends Omit<ToJsonSchema.Options, 'dialect' | 'target'> {}

export class ArkTypeToJsonSchemaConverter implements JsonSchemaConverter {
  private readonly toJsonSchemaOptions: ToJsonSchema.Options

  constructor(options: ArkTypeToJsonSchemaConverterOptions = {}) {
    this.toJsonSchemaOptions = {
      ...options,
      target: 'draft-2020-12',
      fallback: {
        ...(options.fallback && typeof options.fallback !== 'function' ? options.fallback : undefined),
        default: (ctx) => {
          if (ctx.code === 'domain') {
            if (ctx.domain === 'bigint') {
              ;(ctx.base as any).type = 'string'
              ;(ctx.base as any).pattern = '^-?[0-9]+$'
              ;(ctx.base as any)['x-native-type'] = JsonSchemaXNativeType.BigInt
            }
          }
          else if (ctx.code === 'date') {
            ;(ctx.base as any).type = 'string'
            ;(ctx.base as any).format = JsonSchemaFormat.DateTime
            ;(ctx.base as any)['x-native-type'] = JsonSchemaXNativeType.Date
          }

          if (typeof options.fallback === 'function') {
            return options.fallback(ctx)
          }

          if (options.fallback?.default) {
            return options.fallback.default(ctx)
          }

          return ctx.base
        },
      },
    }
  }

  condition(schema: AnySchema | undefined, _direction: JsonSchemaConverterDirection): boolean {
    return schema?.['~standard'].vendor === 'arktype'
  }

  convert(schema: AnySchema | undefined, direction: JsonSchemaConverterDirection): [jsonSchema: JsonSchema, optional: boolean] {
    const arkTypeSchema = schema as Type

    const jsonSchema = this.convertArkType(arkTypeSchema, direction)

    let optional = false
    try {
      const result = arkTypeSchema['~standard'].validate(undefined)
      if (!(result instanceof Promise) && !result.issues) {
        optional = direction === 'input' ? true : result.value === undefined
      }
    }
    catch {}

    return [jsonSchema as JsonSchema, optional]
  }

  private convertArkType(schema: Type, _direction: JsonSchemaConverterDirection): ArkJsonSchema {
    const jsonSchema = schema.toJsonSchema(this.toJsonSchemaOptions)

    // Since the default oRPC format is always draft/2020-12,
    // `$schema` can be safely omitted here.
    const { $schema, ...rest } = jsonSchema
    return rest
  }
}
