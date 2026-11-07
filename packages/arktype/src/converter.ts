import type { JsonSchema as ArkJsonSchema, ToJsonSchema } from '@ark/schema'
import type {
  AnySchema,
  JsonSchema,
  JsonSchemaConverter,
  JsonSchemaConverterDirection,
} from '@orpc/json-schema'
import {
  createUndefinedJsonSchema,
  deduplicateJsonSchemas,
  isStandardSchemaOptional,
  JsonSchemaFormat,
  JsonSchemaXNativeType,
  normalizeJsonSchema,
} from '@orpc/json-schema'
import type { Type } from 'arktype'

export interface ArkTypeToJsonSchemaConverterOptions extends Omit<
  ToJsonSchema.Options,
  'dialect' | 'target'
> {
  /**
   * Caches conversion results in a WeakMap keyed by the ArkType schema instance,
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
 * Converts ArkType schemas into JSON Schema using ArkType's built-in `toJsonSchema`,
 * with additional support for types such as `bigint`, `Date`, `File`, and `Blob`.
 *
 * @see {@link https://orpc.dev/docs/integrations/arktype | ArkType Integration}
 */
export class ArkTypeToJsonSchemaConverter implements JsonSchemaConverter {
  private readonly toJsonSchemaOptions: ToJsonSchema.Options
  private readonly fallback: ToJsonSchema.FallbackObject
  private readonly cache:
    | undefined
    | {
        [d in JsonSchemaConverterDirection]: WeakMap<
          Type,
          [jsonSchema: JsonSchema, optional: boolean]
        >
      }

  constructor({ cache, ...options }: ArkTypeToJsonSchemaConverterOptions = {}) {
    if (cache) {
      this.cache = { input: new WeakMap(), output: new WeakMap() }
    }

    this.fallback = {
      ...(options.fallback && typeof options.fallback !== 'function'
        ? options.fallback
        : undefined),
      default: (ctx) => {
        if (ctx.code === 'arrayPostfix') {
          // JSON Schema can't describe elements after a variadic rest element,
          // so loosen `items` to accept any element type that may follow the prefix
          ctx.base.items = combineAnyOf([ctx.base.items, ...ctx.elements]) as typeof ctx.base.items
        } else if (ctx.code === 'unit') {
          if (ctx.unit === undefined) {
            // JSON can't hold `undefined`: it matches nothing here,
            // and `normalizeJsonSchema` drops it from unions and makes the property optional
            Object.assign(ctx.base, createUndefinedJsonSchema())
          } else if (isNonFiniteNumber(ctx.unit)) {
            // JSON can't hold NaN or ±Infinity, so no JSON value can match them
            ;(ctx.base as any).not = {}
          }
        } else if (ctx.code === 'domain') {
          if (ctx.domain === 'bigint') {
            ;(ctx.base as any).type = 'string'
            ;(ctx.base as any).pattern = '^-?[0-9]+$'
            ;(ctx.base as any)['x-native-type'] = JsonSchemaXNativeType.BigInt
          }
        } else if (ctx.code === 'date') {
          ;(ctx.base as any).type = 'string'
          ;(ctx.base as any).format = JsonSchemaFormat.DateTime
          ;(ctx.base as any)['x-native-type'] = JsonSchemaXNativeType.Date
        } else if (
          ctx.code === 'proto' &&
          (ctx.proto === Blob || ctx.proto.prototype instanceof Blob)
        ) {
          ;(ctx.base as any).type = 'string'
          ;(ctx.base as any).contentMediaType = '*/*'
        }

        if (typeof options.fallback === 'function') {
          return options.fallback(ctx)
        }

        if (options.fallback?.default) {
          return options.fallback.default(ctx)
        }

        return ctx.base
      },
    }

    this.toJsonSchemaOptions = {
      ...options,
      target: 'draft-2020-12',
      fallback: this.fallback,
    }
  }

  condition(schema: AnySchema | undefined, _direction: JsonSchemaConverterDirection): boolean {
    return schema?.['~standard'].vendor === 'arktype'
  }

  convert(
    schema: AnySchema | undefined,
    direction: JsonSchemaConverterDirection,
  ): [jsonSchema: JsonSchema, optional: boolean] {
    const arkTypeSchema = schema as Type

    if (this.cache) {
      const cached = this.cache[direction].get(arkTypeSchema)
      if (cached) {
        return cached
      }
    }

    const result = this.convertUncached(arkTypeSchema, direction)

    if (this.cache) {
      this.cache[direction].set(arkTypeSchema, result)
    }

    return result
  }

  private convertUncached(
    arkTypeSchema: Type,
    direction: JsonSchemaConverterDirection,
  ): [jsonSchema: JsonSchema, optional: boolean] {
    const jsonSchema = this.convertArkType(arkTypeSchema, direction)

    return [jsonSchema as JsonSchema, isStandardSchemaOptional(arkTypeSchema, direction)]
  }

  private convertArkType(schema: Type, direction: JsonSchemaConverterDirection): ArkJsonSchema {
    // `toJsonSchema` describes the input side (and keeps `default` annotations),
    // so output conversions go through `.out` to reflect morph outputs and applied defaults.
    const jsonSchema = (direction === 'output' ? schema.out : schema).toJsonSchema(
      this.toJsonSchemaOptions,
    )

    // Since the default oRPC format is always draft/2020-12,
    // `$schema` can be safely omitted here.
    const { $schema: _schema, ...rest } = jsonSchema
    return normalizeJsonSchema(rest as JsonSchema, {
      resolveNonFiniteValue: (unit) => this.resolveNonFiniteUnit(unit) as JsonSchema,
    }) as ArkJsonSchema
  }

  /**
   * ArkType emits NaN/±Infinity units as `const`/`enum` values without consulting the fallback,
   * so mirror the `unit` fallback call it makes for other unjsonifiable units.
   */
  private resolveNonFiniteUnit(unit: number): ArkJsonSchema {
    const ctx: ToJsonSchema.UnitContext = { code: 'unit', base: {}, unit: unit as any }
    const handler = this.fallback.unit ?? this.fallback.default!
    return handler(ctx)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isFinite(value)
}

function combineAnyOf(schemas: readonly unknown[]): unknown {
  const branches = deduplicateJsonSchemas(
    schemas.flatMap((schema) =>
      isRecord(schema) && Object.keys(schema).length === 1 && Array.isArray(schema.anyOf)
        ? schema.anyOf
        : [schema],
    ) as JsonSchema[],
  )

  return branches.length === 1 ? branches[0] : { anyOf: branches }
}
