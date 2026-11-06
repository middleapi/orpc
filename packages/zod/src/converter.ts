import type {
  AnySchema,
  JsonSchema,
  JsonSchemaConverter,
  JsonSchemaConverterDirection,
} from '@orpc/json-schema'
import {
  createUndefinedJsonSchema,
  isStandardSchemaOptional,
  JsonSchemaFormat,
  JsonSchemaXNativeType,
  normalizeJsonSchema,
  replaceNonFiniteJsonSchemaValues,
} from '@orpc/json-schema'
import type {
  $ZodType,
  $ZodTypes,
  ToJSONSchemaContext,
  ToJSONSchemaParams,
  JSONSchema as ZodJsonSchema,
} from 'zod/v4/core'
import { process as processZodSchema, toJSONSchema } from 'zod/v4/core'

import {
  JSON_SCHEMA_INPUT_REGISTRY,
  JSON_SCHEMA_OUTPUT_REGISTRY,
  JSON_SCHEMA_REGISTRY,
} from './registries.ts'

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
  cache?: boolean | undefined
}

/**
 * Converts Zod schemas into JSON Schema using Zod's built-in `toJSONSchema`,
 * with additional support for types such as `z.bigint()`, `z.date()`, `z.set()`, and `z.map()`.
 *
 * @see {@link https://orpc.dev/docs/integrations/zod | Zod Integration}
 */
export class ZodToJsonSchemaConverter implements JsonSchemaConverter {
  private readonly toJSONSchemaParams: ToJSONSchemaParams
  private readonly cache:
    | undefined
    | {
        [d in JsonSchemaConverterDirection]: WeakMap<
          $ZodType,
          [jsonSchema: JsonSchema, optional: boolean]
        >
      }

  constructor({ cache, ...toJSONSchemaParams }: ZodToJsonSchemaConverterOptions = {}) {
    this.toJSONSchemaParams = toJSONSchemaParams

    if (cache) {
      this.cache = { input: new WeakMap(), output: new WeakMap() }
    }
  }

  condition(schema: AnySchema | undefined, _direction: JsonSchemaConverterDirection): boolean {
    return schema?.['~standard'].vendor === 'zod'
  }

  convert(
    schema: AnySchema | undefined,
    direction: JsonSchemaConverterDirection,
  ): [jsonSchema: JsonSchema, optional: boolean] {
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

  private convertUncached(
    zodSchema: $ZodType,
    direction: JsonSchemaConverterDirection,
  ): [jsonSchema: JsonSchema, optional: boolean] {
    const jsonSchema = this.convertZod(zodSchema, direction)

    return [jsonSchema as JsonSchema, isStandardSchemaOptional(zodSchema, direction)]
  }

  private convertZod(
    schema: $ZodType,
    direction: JsonSchemaConverterDirection,
  ): ZodJsonSchema.JSONSchema {
    const { unrepresentable = 'any' } = this.toJSONSchemaParams

    const jsonSchema = toJSONSchema(schema, {
      ...this.toJSONSchemaParams,
      target: 'draft-2020-12',
      io: direction,
      unrepresentable(this: ToJSONSchemaContext, info) {
        return (
          convertNativeType(this, info.zodSchema, info.path) ??
          (typeof unrepresentable === 'function' ? unrepresentable(info) : unrepresentable)
        )
      },
      override: (ctx) => {
        const customJsonSchema = this.getCustomJsonSchema(ctx.zodSchema, direction)

        if (customJsonSchema) {
          Object.assign(ctx.jsonSchema, customJsonSchema)
        }

        // Zod drops the `undefined` member of a literal, so add it back for `normalizeJsonSchema`
        const def = ctx.zodSchema._zod.def
        if (
          def.type === 'literal' &&
          def.values.includes(undefined) &&
          def.values.some((value) => value !== undefined)
        ) {
          const literal = replaceNonFiniteJsonSchemaValues({ ...ctx.jsonSchema } as JsonSchema)
          replaceJsonSchemaInPlace(ctx.jsonSchema, {
            anyOf: [literal, createUndefinedJsonSchema()],
          } as ZodJsonSchema.BaseSchema)
        }

        this.toJSONSchemaParams.override?.(ctx)

        // Zod JSON-clones its result, turning NaN/±Infinity into `null`, so replace them before that,
        // including any a custom override wrote
        const replaced = replaceNonFiniteJsonSchemaValues(ctx.jsonSchema as JsonSchema)
        if (replaced !== ctx.jsonSchema) {
          replaceJsonSchemaInPlace(ctx.jsonSchema, replaced as ZodJsonSchema.BaseSchema)
        }
      },
    })

    // Since the default oRPC format is always draft/2020-12,
    // `$schema` can be safely omitted here.
    const { $schema: _schema, ...rest } = jsonSchema

    return normalizeJsonSchema(rest as JsonSchema) as ZodJsonSchema.JSONSchema
  }

  private getCustomJsonSchema(
    schema: $ZodType,
    direction: JsonSchemaConverterDirection,
  ): Exclude<JsonSchema, boolean> | undefined {
    const general = JSON_SCHEMA_REGISTRY.get(schema)
    const directional =
      direction === 'input'
        ? JSON_SCHEMA_INPUT_REGISTRY.get(schema)
        : JSON_SCHEMA_OUTPUT_REGISTRY.get(schema)

    if (general === undefined && directional === undefined) {
      return undefined
    }

    return { ...general, ...directional } as Exclude<JsonSchema, boolean>
  }
}

function convertNativeType(
  ctx: ToJSONSchemaContext,
  zodSchema: $ZodTypes,
  path: (string | number)[],
): ZodJsonSchema.BaseSchema | 'any' | undefined {
  const def = zodSchema._zod.def

  switch (def.type) {
    case 'undefined':
    case 'void':
      // JSON can't hold `undefined`: `normalizeJsonSchema` drops it from unions and makes the property optional
      return createUndefinedJsonSchema() as ZodJsonSchema.BaseSchema
    case 'nan':
      // JSON can't hold NaN, so no JSON value can match it
      return { not: {} }
    case 'literal':
      if (def.values.every((value) => value === undefined)) {
        return createUndefinedJsonSchema() as ZodJsonSchema.BaseSchema
      }

      // skip the `undefined` member, the `override` adds it back as an `undefined` branch;
      // bigint members share this callback, so leave literals holding them to the user's setting
      if (
        def.values.includes(undefined) &&
        !def.values.some((value) => typeof value === 'bigint')
      ) {
        return 'any'
      }

      return undefined
    case 'bigint':
      return {
        'type': 'string',
        'pattern': '^-?[0-9]+$',
        'x-native-type': JsonSchemaXNativeType.BigInt,
      }
    case 'date':
      return {
        'type': 'string',
        'format': JsonSchemaFormat.DateTime,
        'x-native-type': JsonSchemaXNativeType.Date,
      }
    case 'set':
    case 'map': {
      const schemaPath: $ZodType[] = []
      for (const [seenSchema, seen] of ctx.seen) {
        if (
          seen.path &&
          seen.path.length <= path.length &&
          seen.path.every((segment, i) => segment === path[i])
        ) {
          schemaPath.push(seenSchema)
        }
      }

      const processItems = (schema: $ZodType, ...segments: (string | number)[]) =>
        processZodSchema(schema, ctx, { path: [...path, 'items', ...segments], schemaPath })

      return def.type === 'set'
        ? {
            'type': 'array',
            'uniqueItems': true,
            'items': processItems(def.valueType),
            'x-native-type': JsonSchemaXNativeType.Set,
          }
        : {
            'type': 'array',
            'items': {
              type: 'array',
              prefixItems: [
                processItems(def.keyType, 'prefixItems', 0),
                processItems(def.valueType, 'prefixItems', 1),
              ],
              maxItems: 2,
              minItems: 2,
            },
            'x-native-type': JsonSchemaXNativeType.Map,
          }
    }
  }

  return undefined
}

function replaceJsonSchemaInPlace(
  target: ZodJsonSchema.BaseSchema,
  replacement: ZodJsonSchema.BaseSchema,
): void {
  for (const key of Object.keys(target)) {
    delete target[key]
  }

  Object.assign(target, replacement)
}
