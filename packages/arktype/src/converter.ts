import type { ToJsonSchema } from '@ark/schema'
import type { AnySchema } from '@orpc/contract'
import type { ConditionalSchemaConverter, JSONSchema, SchemaConvertOptions } from '@orpc/openapi'
import type { Type } from 'arktype'
import { JSONSchemaFormat } from '@orpc/openapi'

const defaultToJsonSchemaFallback: ToJsonSchema.FallbackOption = {
  date: ctx => ({
    ...ctx.base,
    type: 'string',
    format: JSONSchemaFormat.DateTime,
  }),
}

export class experimental_ArkTypeToJsonSchemaConverter implements ConditionalSchemaConverter {
  #options: ToJsonSchema.Options

  constructor(options: ToJsonSchema.Options = {}) {
    this.#options = {
      ...options,
      fallback: {
        ...defaultToJsonSchemaFallback,
        ...options?.fallback,
      },
    }
  }

  condition(schema: AnySchema | undefined): boolean {
    return schema !== undefined && schema['~standard'].vendor === 'arktype'
  }

  convert(schema: AnySchema | undefined, _options: SchemaConvertOptions): [required: boolean, jsonSchema: Exclude<JSONSchema, boolean>] {
    const jsonSchema = (schema as Type).toJsonSchema(this.#options)

    return [true, jsonSchema]
  }
}
