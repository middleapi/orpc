import type { JsonSchema as ArkJsonSchema, ToJsonSchema } from '@ark/schema'
import type {
  AnySchema,
  JsonSchema,
  JsonSchemaConverter,
  JsonSchemaConverterDirection,
} from '@orpc/json-schema'
import {
  deduplicateJsonSchemas,
  ensureJsonSchemaObject,
  getJsonSchemaKeywordKind,
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

    const userFallback = options.fallback
    const userHandlers =
      userFallback && typeof userFallback !== 'function' ? userFallback : undefined

    // built-in handling runs before every user handler, so a per-code override (e.g. `unit`)
    // still gets the `undefined` marker, postfix widening and native type extensions
    const wrappedHandlers = Object.fromEntries(
      Object.entries(userHandlers ?? {})
        .filter(([code, handler]) => code !== 'default' && handler)
        .map(([code, handler]) => [
          code,
          (ctx: ToJsonSchema.FallbackContext) => {
            applyBuiltInFallback(ctx)
            return (handler as ToJsonSchema.UniversalFallback)(ctx)
          },
        ]),
    )

    this.fallback = {
      ...wrappedHandlers,
      default: (ctx) => {
        applyBuiltInFallback(ctx)

        if (typeof userFallback === 'function') {
          return userFallback(ctx)
        }

        if (userHandlers?.default) {
          return userHandlers.default(ctx)
        }

        // returning `ctx.base` here would make the schema its own `default`
        if (ctx.code === 'defaultValue') {
          return toJsonDefaultValue(ctx.value) as any
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
    return this.normalizeJsonSchema(rest, direction)
  }

  private normalizeJsonSchema(
    root: ArkJsonSchema,
    direction: JsonSchemaConverterDirection,
  ): ArkJsonSchema {
    const defs = (root as Exclude<JsonSchema, boolean>).$defs

    // `only: false` → the schema accepts `undefined`; `only: true` → it accepts nothing else
    const acceptsUndefined = (
      schema: unknown,
      only: boolean,
      seen = new Set<unknown>(),
    ): boolean => {
      if (!isRecord(schema) || seen.has(schema)) {
        return false
      }
      seen.add(schema)

      if (UNDEFINED_MARKER in schema) {
        return true
      }

      const check = (branch: unknown) => acceptsUndefined(branch, only, seen)

      for (const key of ['anyOf', 'oneOf'] as const) {
        const branches = schema[key]
        if (Array.isArray(branches) && (only ? branches.every(check) : branches.some(check))) {
          return true
        }
      }

      const allOf = schema.allOf
      if (
        Array.isArray(allOf) &&
        allOf.length > 0 &&
        (only ? allOf.some(check) : allOf.every(check))
      ) {
        return true
      }

      const resolved = resolveJsonSchemaRootLocalRef(schema as JsonSchema, defs)
      return resolved !== schema && check(resolved)
    }

    const normalize = (schema: unknown): unknown => {
      if (!isRecord(schema)) {
        return schema
      }

      const { [UNDEFINED_MARKER]: marker, ...result } = schema as Record<PropertyKey, unknown>

      // a schema that only accepts `undefined` stays unconstrained, as it was before the marker:
      // generators read `{}` (with the optional flag) as an absent input, body or property;
      // union branches carrying the marker are dropped before they get here
      if (marker) {
        delete result.not
      }

      if (isNonFiniteNumber(result.const)) {
        const { const: unit, ...rest } = result
        return {
          ...ensureJsonSchemaObject(this.resolveNonFiniteUnit(unit) as JsonSchema),
          ...(normalize(rest) as object),
        }
      }

      for (const key of Object.keys(result)) {
        const value = result[key]

        if (key === 'const' || key === 'enum' || key === 'anyOf' || key === 'oneOf') {
          continue
        }

        // a bound on the open side (`maximum: Infinity`) or an annotation (`default: Infinity`)
        // constrains nothing; a bound past every number (`minimum: Infinity`) allows nothing
        if (isNonFiniteNumber(value)) {
          if (
            ((key === 'minimum' || key === 'exclusiveMinimum') && value > 0) ||
            ((key === 'maximum' || key === 'exclusiveMaximum') && value < 0)
          ) {
            result.not = {}
          }
          delete result[key]
          continue
        }

        switch (getJsonSchemaKeywordKind(key, value)) {
          case 'schema':
            result[key] = Array.isArray(value) ? value.map(normalize) : normalize(value)
            break
          case 'schema-record':
            result[key] = Object.fromEntries(
              Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, normalize(v)]),
            )
            break
          case 'data':
            if (key === 'examples' && Array.isArray(value)) {
              result[key] = value.filter((example) => !isNonFiniteNumber(example))
            }
            break
        }
      }

      // requests must still send the key (JSON can't carry `undefined`),
      // but responses omit it since the serializer drops `undefined` properties
      if (direction === 'output' && isRecord(schema.properties) && Array.isArray(schema.required)) {
        const properties = schema.properties
        const required = schema.required.filter((key) => !acceptsUndefined(properties[key], false))
        if (required.length) {
          result.required = required
        } else {
          delete result.required
        }
      }

      if (Array.isArray(result.enum)) {
        const nonFinite = result.enum.filter(isNonFiniteNumber)
        if (nonFinite.length) {
          const finite = result.enum.filter((value) => !isNonFiniteNumber(value))
          result.anyOf = [
            ...(finite.length ? [{ enum: finite }] : []),
            ...nonFinite.map((unit) => ({ const: unit })),
          ]
          delete result.enum
        }
      }

      for (const key of ['anyOf', 'oneOf'] as const) {
        const branches = result[key]
        if (!Array.isArray(branches)) {
          continue
        }

        const kept = branches
          .filter((branch) => !acceptsUndefined(branch, true))
          .map(normalize)
          .filter((branch) => !isNeverSchema(branch))

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

  /** ArkType emits ±Infinity as `const`/`enum` without calling the `unit` fallback it uses for NaN. */
  private resolveNonFiniteUnit(unit: number): ArkJsonSchema {
    const ctx: ToJsonSchema.UnitContext = { code: 'unit', base: {}, unit: unit as any }
    const handler = this.fallback.unit ?? this.fallback.default!
    return handler(ctx)
  }
}

/** A symbol so it survives `{ ...ctx.base }` in custom fallbacks without appearing in the output. */
const UNDEFINED_MARKER: unique symbol = Symbol('ORPC_ARKTYPE_UNDEFINED')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isFinite(value)
}

/** `not: {}` fails every value, whatever other keywords sit beside it. */
function isNeverSchema(schema: unknown): boolean {
  return (
    schema === false ||
    (isRecord(schema) &&
      ((isRecord(schema.not) && Object.keys(schema.not).length === 0) ||
        (Array.isArray(schema.allOf) && schema.allOf.some(isNeverSchema))))
  )
}

function applyBuiltInFallback(ctx: ToJsonSchema.FallbackContext): void {
  const base = ctx.base as Record<PropertyKey, unknown>

  if (ctx.code === 'arrayPostfix') {
    // JSON Schema can't express elements after a rest element, so `items` must also accept them
    ctx.base.items = combineAnyOf([ctx.base.items, ...ctx.elements]) as typeof ctx.base.items
  } else if (ctx.code === 'unit') {
    if (ctx.unit === undefined || isNonFiniteNumber(ctx.unit)) {
      base.not = {}
    }
    if (ctx.unit === undefined) {
      base[UNDEFINED_MARKER] = true
    }
  } else if (ctx.code === 'domain') {
    if (ctx.domain === 'bigint') {
      base.type = 'string'
      base.pattern = '^-?[0-9]+$'
      base['x-native-type'] = JsonSchemaXNativeType.BigInt
    }
  } else if (ctx.code === 'date') {
    base.type = 'string'
    base.format = JsonSchemaFormat.DateTime
    base['x-native-type'] = JsonSchemaXNativeType.Date
  } else if (ctx.code === 'proto' && (ctx.proto === Blob || ctx.proto.prototype instanceof Blob)) {
    base.type = 'string'
    base.contentMediaType = '*/*'
  }
}

/** A bigint default is written as the string its `x-native-type` schema expects; others are omitted. */
function toJsonDefaultValue(value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : undefined
}

function combineAnyOf(schemas: readonly unknown[]): unknown {
  const branches = deduplicateJsonSchemas(
    schemas.flatMap((schema) =>
      isRecord(schema) && Object.keys(schema).length === 1 && Array.isArray(schema.anyOf)
        ? schema.anyOf
        : [schema],
    ) as JsonSchema[],
  )

  return { anyOf: branches }
}
