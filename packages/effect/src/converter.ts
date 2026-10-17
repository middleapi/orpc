import type { AnySchema } from '@orpc/contract'
import type { JsonSchema, JsonSchemaConverter, JsonSchemaConverterDirection } from '@orpc/json-schema'
import { isStandardSchemaOptional } from '@orpc/json-schema'
import { Schema as EffectSchema, Predicate } from 'effect'

/**
 * Effect brands `Schema.flip` results with this key but exports no guard for it.
 */
const FLIP_TYPE_ID = '~effect/Schema/flip'

function isFlippedSchema(schema: EffectSchema.Top): schema is EffectSchema.flip<EffectSchema.Top> {
  return Predicate.hasProperty(schema, FLIP_TYPE_ID) && schema[FLIP_TYPE_ID] === FLIP_TYPE_ID
}

export interface EffectSchemaToJsonSchemaConverterOptions extends EffectSchema.ToJsonSchemaOptions {
  /**
   * Caches conversion results in a WeakMap keyed by the Effect schema instance,
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
 * Converts Effect schemas into JSON Schema using Effect's built-in
 * [`Schema.toJsonSchemaDocument`](https://effect.website/docs/schema/json-schema/).
 * Useful with tools such as the OpenAPI Generator.
 *
 * @see {@link https://orpc.dev/docs/integrations/effect#json-schema-converter | Effect Integration - JSON Schema Converter}
 */
export class EffectSchemaToJsonSchemaConverter implements JsonSchemaConverter {
  private readonly toJsonSchemaOptions: EffectSchema.ToJsonSchemaOptions
  private readonly cache: undefined | { [d in JsonSchemaConverterDirection]: WeakMap<EffectSchema.Top, [jsonSchema: JsonSchema, optional: boolean]> }

  constructor({ cache, ...toJsonSchemaOptions }: EffectSchemaToJsonSchemaConverterOptions = {}) {
    this.toJsonSchemaOptions = toJsonSchemaOptions

    if (cache) {
      this.cache = { input: new WeakMap(), output: new WeakMap() }
    }
  }

  condition(schema: AnySchema | undefined, _direction: JsonSchemaConverterDirection): boolean {
    return schema?.['~standard'].vendor === 'effect' && EffectSchema.isSchema(schema)
  }

  convert(schema: AnySchema | undefined, direction: JsonSchemaConverterDirection): [jsonSchema: JsonSchema, optional: boolean] {
    const effectSchema = schema as EffectSchema.Top & AnySchema

    if (this.cache) {
      const cached = this.cache[direction].get(effectSchema)
      if (cached) {
        return cached
      }
    }

    const result = this.convertUncached(effectSchema, direction)

    if (this.cache) {
      this.cache[direction].set(effectSchema, result)
    }

    return result
  }

  private convertUncached(schema: EffectSchema.Top & AnySchema, direction: JsonSchemaConverterDirection): [jsonSchema: JsonSchema, optional: boolean] {
    return [this.convertEffect(schema, direction), isStandardSchemaOptional(schema, direction)]
  }

  private convertEffect(schema: EffectSchema.Top, direction: JsonSchemaConverterDirection): JsonSchema {
    /**
     * A flipped `Schema.flip(S)` output produces the encoded side of `S`. Converting `S` itself in the
     * opposite direction keeps the same `$defs` (e.g. `Schema.Class`) that `S` produces as an input.
     */
    if (isFlippedSchema(schema)) {
      return this.convertEffect(EffectSchema.flip(schema), direction === 'input' ? 'output' : 'input')
    }

    const { schema: jsonSchema, definitions } = EffectSchema.toJsonSchemaDocument(
      direction === 'input' ? schema : EffectSchema.toType(schema),
      this.toJsonSchemaOptions,
    )

    return (Object.keys(definitions).length > 0 ? { ...jsonSchema, $defs: definitions } : jsonSchema) as JsonSchema
  }
}
