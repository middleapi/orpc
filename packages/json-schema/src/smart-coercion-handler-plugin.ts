import type { AnySchema } from '@orpc/contract'
import type { Context } from '@orpc/server'
import type { StandardHandlerOptions, StandardHandlerPlugin } from '@orpc/server/standard'
import { toArray } from '@orpc/shared'

import type { JsonSchemaCoercerOptions } from './coercer.ts'
import { JsonSchemaCoercer } from './coercer.ts'
import type { JsonSchemaConverter } from './convert.ts'
import { DelegatingJsonSchemaConverter } from './convert.ts'
import { StandardJsonSchemaConverter } from './standard-json-schema-converter.ts'
import type { JsonSchema } from './types.ts'

export interface SmartCoercionHandlerPluginOptions extends JsonSchemaCoercerOptions {
  converters?: JsonSchemaConverter[] | undefined
}

/**
 * Coerces incoming request data to match the expected `.input` schema types before validation,
 * based on JSON schemas produced by the configured converters.
 *
 * @see {@link https://orpc.dev/docs/plugins/smart-coercion | Smart Coercion Plugin}
 */
export class SmartCoercionHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~smart-coercion'

  private readonly converter: DelegatingJsonSchemaConverter
  private readonly coercer: JsonSchemaCoercer
  private readonly cache: WeakMap<AnySchema, [JsonSchema, optional: boolean]> = new WeakMap()

  constructor(options: SmartCoercionHandlerPluginOptions = {}) {
    this.converter = new DelegatingJsonSchemaConverter([
      ...toArray(options.converters),
      new StandardJsonSchemaConverter(),
    ])
    this.coercer = new JsonSchemaCoercer(options)
  }

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    return {
      ...options,
      clientInterceptors: [
        ({ next, input, ...interceptorOptions }) => {
          const inputSchemas = interceptorOptions.procedure['~orpc'].inputSchemas

          if (!inputSchemas) {
            return next()
          }

          const coercedInput = this.coerceValue(inputSchemas, input)
          return next({ ...interceptorOptions, input: coercedInput })
        },
        ...toArray(options.clientInterceptors),
      ],
    }
  }

  private coerceValue(schemas: AnySchema[], value: unknown): unknown {
    for (const schema of schemas) {
      let converted = this.cache.get(schema)

      if (!converted) {
        converted = this.converter.convert(schema, 'input')
        this.cache.set(schema, converted)
      }

      value = this.coercer.coerce(converted, value)
    }

    return value
  }
}
