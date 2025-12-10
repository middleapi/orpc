import type { AnySchema } from '@orpc/contract'
import type { ConditionalSchemaConverter, SchemaConverter } from '@orpc/openapi'
import type { Context } from '@orpc/server'
import type { StandardHandlerOptions, StandardHandlerPlugin } from '@orpc/server/standard'
import type { JsonSchema } from './types'
import { CompositeSchemaConverter } from '@orpc/openapi'
import { toArray } from '@orpc/shared'
import {
  JsonSchemaCoercer,
} from './coercer'

export interface SmartCoercionPluginOptions {
  schemaConverters?: readonly ConditionalSchemaConverter[]
}

export class SmartCoercionPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  private readonly converter: SchemaConverter
  private readonly coercer: JsonSchemaCoercer
  private readonly cache: WeakMap<AnySchema, JsonSchema> = new WeakMap()

  constructor(options: SmartCoercionPluginOptions = {}) {
    this.converter = new CompositeSchemaConverter(toArray(options.schemaConverters))
    this.coercer = new JsonSchemaCoercer()
  }

  init(options: StandardHandlerOptions<T>): void {
    options.clientInterceptors ??= []

    options.clientInterceptors.unshift(async (options) => {
      const inputSchema = options.procedure['~orpc'].inputSchema

      if (!inputSchema) {
        return options.next()
      }

      const coercedInput = await this.#coerce(inputSchema, options.input)

      return options.next({ ...options, input: coercedInput })
    })
  }

  async #coerce(schema: AnySchema, value: unknown): Promise<unknown> {
    let jsonSchema = this.cache.get(schema)

    if (!jsonSchema) {
      jsonSchema = (await this.converter.convert(schema, { strategy: 'input' }))[1]
      this.cache.set(schema, jsonSchema)
    }

    return this.coercer.coerce(jsonSchema, value)
  }
}
