import type { JsonSchema as ArkJsonSchema, ToJsonSchema } from '@ark/schema'
import type {
  AnySchema,
  JsonSchema,
  JsonSchemaConverter,
  JsonSchemaConverterDirection,
} from '@orpc/json-schema'
import {
  isStandardSchemaOptional,
  JsonSchemaFormat,
  JsonSchemaXNativeType,
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
  /** `undefined` unit schemas produced by the built-in fallback, recognized by identity */
  private readonly undefinedSchemas = new WeakSet()
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
            this.undefinedSchemas.add(ctx.base)
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
    const defs = (root as Record<string, unknown>).$defs as Record<string, unknown> | undefined
    const undefinableRefs = new Map<string, boolean>()

    const isUndefinable = (schema: unknown): boolean => {
      if (!isRecord(schema)) {
        return false
      }

      if (this.undefinedSchemas.has(schema)) {
        return true
      }

      const branches = schema.anyOf ?? schema.oneOf
      if (Array.isArray(branches) && branches.some(isUndefinable)) {
        return true
      }

      if (typeof schema.$ref === 'string' && schema.$ref.startsWith('#/$defs/')) {
        const ref = schema.$ref
        if (!undefinableRefs.has(ref)) {
          undefinableRefs.set(ref, false) // guard against cycles
          undefinableRefs.set(ref, isUndefinable(defs?.[ref.slice('#/$defs/'.length)]))
        }
        return undefinableRefs.get(ref)!
      }

      return false
    }

    const normalize = (schema: unknown): unknown => {
      if (!isRecord(schema)) {
        return schema
      }

      if (this.undefinedSchemas.has(schema)) {
        return { not: {} }
      }

      if (isNonFiniteNumber(schema.const)) {
        const { const: unit, ...rest } = schema
        return { ...rest, ...(this.resolveNonFiniteUnit(unit) as object) }
      }

      const result: Record<string, unknown> = { ...schema }

      for (const key of SINGLE_SCHEMA_KEYWORDS) {
        if (key in result) {
          result[key] = normalize(result[key])
        }
      }

      for (const key of SCHEMA_RECORD_KEYWORDS) {
        if (isRecord(result[key])) {
          result[key] = Object.fromEntries(
            Object.entries(result[key]).map(([k, v]) => [k, normalize(v)]),
          )
        }
      }

      for (const key of SCHEMA_ARRAY_KEYWORDS) {
        if (Array.isArray(result[key])) {
          result[key] = result[key].map(normalize)
        }
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
        const extra = result.enum
          .filter(isNonFiniteNumber)
          .map((unit) => this.resolveNonFiniteUnit(unit))
          .filter((schema) => !isNeverSchema(schema))

        delete result.enum
        const branches = [...(finite.length ? [{ enum: finite }] : []), ...extra]
        result.anyOf = [...(Array.isArray(result.anyOf) ? result.anyOf : []), ...branches]
        if (!branches.length) {
          result.not = {}
        }
      }

      for (const key of ['anyOf', 'oneOf'] as const) {
        const branches = result[key]
        if (!Array.isArray(branches)) {
          continue
        }

        const kept = branches.filter((branch) => !isNeverSchema(branch))
        if (!kept.length) {
          delete result[key]
          result.not = {}
        } else if (kept.length === 1 && Object.keys(result).length === 1) {
          return kept[0]
        } else {
          result[key] = kept
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

const SINGLE_SCHEMA_KEYWORDS = [
  'items',
  'contains',
  'additionalProperties',
  'propertyNames',
  'unevaluatedItems',
  'unevaluatedProperties',
  'not',
  'if',
  'then',
  'else',
] as const

const SCHEMA_RECORD_KEYWORDS = [
  'properties',
  'patternProperties',
  'dependentSchemas',
  '$defs',
] as const

const SCHEMA_ARRAY_KEYWORDS = ['prefixItems', 'allOf', 'anyOf', 'oneOf'] as const

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
  const unique: unknown[] = []
  const seen = new Set<string>()

  for (const schema of schemas) {
    const branches =
      isRecord(schema) && Object.keys(schema).length === 1 && Array.isArray(schema.anyOf)
        ? schema.anyOf
        : [schema]

    for (const branch of branches) {
      // tag non-finite numbers so they don't collide with `null`;
      // branches are always schemas here, so the result is never undefined
      // oxlint-disable-next-line no-restricted-properties
      const key = JSON.stringify(branch, (_, value) =>
        isNonFiniteNumber(value) ? `__non-finite:${value}` : value,
      )
      if (!seen.has(key)) {
        seen.add(key)
        unique.push(branch)
      }
    }
  }

  return unique.length === 1 ? unique[0] : { anyOf: unique }
}
