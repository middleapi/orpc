import type { ToJsonSchema } from '@ark/schema'
import type { AnySchema } from '@orpc/contract'
import type { ConditionalSchemaConverter, JSONSchema, SchemaConvertOptions } from '@orpc/openapi'
import type { Type } from 'arktype'

const defaultFallbacks: ToJsonSchema.FallbackOption = {
  date: ctx => ({
    ...ctx.base,
    type: 'string',
    format: 'date-time',
  }),
}

export class experimental_ArkTypeToJsonSchemaConverter implements ConditionalSchemaConverter {
  options: ToJsonSchema.Options | undefined

  constructor(_options?: ToJsonSchema.Options) {
    this.options = {
      ..._options,
      fallback: {
        ...defaultFallbacks,
        ..._options?.fallback,
      },
    }
  }

  condition(schema: AnySchema | undefined): boolean {
    return schema !== undefined && schema['~standard'].vendor === 'arktype'
  }

  convert(schema: AnySchema | undefined, _options: SchemaConvertOptions): [required: boolean, jsonSchema: Exclude<JSONSchema, boolean>] {
    const jsonSchema = (schema as Type).toJsonSchema(this.options)

    return [true, jsonSchema]
  }
}
