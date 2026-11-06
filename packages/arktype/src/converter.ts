import type { JsonSchema as ArkJsonSchema, ToJsonSchema } from '@ark/schema'
import type {
  AnySchema,
  JsonSchema,
  JsonSchemaConverter,
  JsonSchemaConverterDirection,
} from '@orpc/json-schema'
import {
  deduplicateJsonSchemas,
  isStandardSchemaOptional,
  JsonSchemaFormat,
  JsonSchemaXNativeType,
  resolveJsonSchemaRootLocalRef,
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
 * with additional support for types such as `bigint` and `Date`.
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
            ;(ctx.base as any).not = {}
            ;(ctx.base as any)[UNDEFINED_MARKER] = true
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
    return this.normalizeJsonSchema(rest)
  }

  /**
   * Fixes up what ArkType's `toJsonSchema` can't express in JSON:
   * - drops `undefined` branches from unions and makes properties that accept `undefined` optional
   * - routes `const`/`enum` NaN or ±Infinity (which ArkType emits as-is) through the `unit` fallback
   */
  private normalizeJsonSchema(root: ArkJsonSchema): ArkJsonSchema {
    const defs = (root as Exclude<JsonSchema, boolean>).$defs

    const isUndefinable = (schema: unknown, seen = new Set<unknown>()): boolean => {
      if (!isRecord(schema) || seen.has(schema)) {
        return false
      }
      seen.add(schema)

      if (UNDEFINED_MARKER in schema) {
        return true
      }

      if (
        Array.isArray(schema.anyOf) &&
        schema.anyOf.some((branch) => isUndefinable(branch, seen))
      ) {
        return true
      }

      const resolved = resolveJsonSchemaRootLocalRef(schema as JsonSchema, defs)
      return resolved !== schema && isUndefinable(resolved, seen)
    }

    // only the keywords ArkType's `toJsonSchema` emits need walking
    const normalize = (schema: unknown): unknown => {
      if (!isRecord(schema)) {
        return schema
      }

      if (isNonFiniteNumber(schema.const)) {
        const { const: unit, ...rest } = schema
        return { ...rest, ...this.resolveNonFiniteUnit(unit) }
      }

      const result: Record<string, unknown> = { ...schema }
      delete (result as Record<PropertyKey, unknown>)[UNDEFINED_MARKER]

      for (const key of ['items', 'additionalProperties'] as const) {
        if (key in result) {
          result[key] = normalize(result[key])
        }
      }

      for (const key of ['properties', 'patternProperties', '$defs'] as const) {
        if (isRecord(result[key])) {
          result[key] = Object.fromEntries(
            Object.entries(result[key]).map(([k, v]) => [k, normalize(v)]),
          )
        }
      }

      if (Array.isArray(result.prefixItems)) {
        result.prefixItems = result.prefixItems.map(normalize)
      }

      if (isRecord(schema.properties) && Array.isArray(schema.required)) {
        const properties = schema.properties
        const required = schema.required.filter((key) => !isUndefinable(properties[key]))
        if (required.length) {
          result.required = required
        } else {
          delete result.required
        }
      }

      if (Array.isArray(result.enum) && result.enum.some(isNonFiniteNumber)) {
        const finite = result.enum.filter((value) => !isNonFiniteNumber(value))
        result.anyOf = [
          ...(finite.length ? [{ enum: finite }] : []),
          ...result.enum.filter(isNonFiniteNumber).map((unit) => this.resolveNonFiniteUnit(unit)),
        ]
        delete result.enum
      }

      if (Array.isArray(result.anyOf)) {
        const kept = result.anyOf
          .filter((branch) => !(isRecord(branch) && UNDEFINED_MARKER in branch))
          .map(normalize)
          .filter((branch) => !isNeverSchema(branch))

        if (!kept.length) {
          delete result.anyOf
          result.not = {}
        } else if (kept.length === 1 && Object.keys(result).length === 1) {
          return kept[0]
        } else {
          result.anyOf = kept
        }
      }

      return result
    }

    return normalize(root) as ArkJsonSchema
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

/**
 * Marks the built-in `undefined` unit schema, so the property holding it can be made optional.
 * A symbol survives spreads in custom fallbacks and is never serialized; `normalize` strips it.
 */
const UNDEFINED_MARKER: unique symbol = Symbol('ORPC_ARKTYPE_UNDEFINED')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isFinite(value)
}

function isNeverSchema(schema: unknown): boolean {
  return (
    schema === false ||
    (isRecord(schema) &&
      Object.keys(schema).length === 1 &&
      isRecord(schema.not) &&
      Object.keys(schema.not).length === 0)
  )
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
