/**
 * These utilities assume the schema has only one root-level `$defs` object
 * and exclusively use absolute JSON pointers for `$ref` values.
 */

import { JSON_SCHEMA_LOGIC_KEYWORDS, JSON_SCHEMA_RECORD_KEYWORDS } from './constants.ts'
import { resolveJsonSchemaRootLocalRef } from './ref-utils.ts'
import type { JsonSchema } from './types.ts'
import { ensureJsonSchemaObject } from './utils.ts'

/**
 * Key a converter sets on the schema it emits for `undefined`, so {@link normalizeJsonSchema}
 * can drop it from unions and make the property holding it optional.
 *
 * A plain string key (not a symbol) survives converters that JSON-clone their output,
 * and {@link normalizeJsonSchema} strips it, so it never reaches the generated document.
 */
export const JSON_SCHEMA_UNDEFINED_MARKER = 'x-orpc-undefined'

/**
 * Creates the schema a converter emits for `undefined`.
 * JSON can't hold `undefined`, so it matches nothing and carries {@link JSON_SCHEMA_UNDEFINED_MARKER}.
 */
export function createUndefinedJsonSchema(): Exclude<JsonSchema, boolean> {
  return { not: {}, [JSON_SCHEMA_UNDEFINED_MARKER]: true }
}

export interface NormalizeJsonSchemaOptions {
  /**
   * Builds the schema standing for a `NaN` or `±Infinity` `const`/`enum` value, which JSON can't hold.
   *
   * @default () => ({ not: {} })
   */
  resolveNonFiniteValue?: ((value: number) => JsonSchema) | undefined
}

/**
 * Fixes up what converters emit for values JSON can't hold:
 * - drops `undefined` branches (marked with {@link JSON_SCHEMA_UNDEFINED_MARKER}) from `anyOf`/`oneOf`
 * - removes properties that accept `undefined`, directly or through a root-local `$ref`, from `required`,
 *   since serializers omit `undefined` properties
 * - replaces `NaN`/`±Infinity` `const`/`enum` values with {@link NormalizeJsonSchemaOptions.resolveNonFiniteValue},
 *   whose result is kept as returned
 *
 * Unchanged sub-schemas keep their identity, so a schema that needs no fixing is returned as-is.
 */
export function normalizeJsonSchema(
  schema: JsonSchema,
  options: NormalizeJsonSchemaOptions = {},
): JsonSchema {
  const $defs = typeof schema === 'object' ? schema.$defs : undefined
  return normalizeSchema(schema, $defs, options)
}

/**
 * Replaces the `NaN`/`±Infinity` values of a schema's own `const`/`enum`, without walking sub-schemas.
 * Returns the schema itself when it holds none.
 *
 * Useful inside converter hooks, for converters that would lose non-finite values
 * (e.g. by JSON-cloning) before {@link normalizeJsonSchema} could see them.
 */
export function replaceNonFiniteJsonSchemaValues(
  schema: JsonSchema,
  { resolveNonFiniteValue = resolveNeverSchema }: NormalizeJsonSchemaOptions = {},
): JsonSchema {
  if (typeof schema === 'boolean') {
    return schema
  }

  if (isNonFiniteNumber(schema.const)) {
    const { const: value, ...rest } = schema
    return { ...rest, ...ensureJsonSchemaObject(resolveNonFiniteValue(value)) }
  }

  if (!Array.isArray(schema.enum) || !schema.enum.some(isNonFiniteNumber)) {
    return schema
  }

  const { enum: values, ...rest } = schema
  const finite = values.filter((value) => !isNonFiniteNumber(value))
  const branches: JsonSchema[] = [
    ...(finite.length ? [{ enum: finite }] : []),
    ...values
      .filter(isNonFiniteNumber)
      .map((value) => resolveNonFiniteValue(value))
      .filter((branch) => !isNeverSchema(branch)),
  ]

  if (branches.length <= 1) {
    return { ...rest, ...ensureJsonSchemaObject(branches[0] ?? false) }
  }

  if (rest.anyOf === undefined) {
    return { ...rest, anyOf: branches }
  }

  return { ...rest, allOf: [...(rest.allOf ?? []), { anyOf: branches }] }
}

function normalizeSchema(
  schema: JsonSchema,
  $defs: Exclude<JsonSchema, boolean>['$defs'],
  options: NormalizeJsonSchemaOptions,
): JsonSchema {
  if (typeof schema !== 'object' || schema === null) {
    return schema
  }

  let result: Record<string, unknown> | undefined
  const set = (key: string, value: unknown) => {
    result ??= { ...schema }
    result[key] = value
  }
  const unset = (key: string) => {
    result ??= { ...schema }
    delete result[key]
  }

  if (JSON_SCHEMA_UNDEFINED_MARKER in schema) {
    unset(JSON_SCHEMA_UNDEFINED_MARKER)
  }

  for (const key of Object.keys(schema)) {
    // `const`/`enum` hold values, not sub-schemas
    if (key === 'const' || key === 'enum') {
      continue
    }

    if (!JSON_SCHEMA_LOGIC_KEYWORDS.has(key) && !JSON_SCHEMA_RECORD_KEYWORDS.has(key)) {
      continue
    }

    const value = (schema as Record<string, unknown>)[key]
    const normalized = JSON_SCHEMA_RECORD_KEYWORDS.has(key)
      ? normalizeSchemaRecord(value, $defs, options)
      : normalizeSchemaOrArray(value, $defs, options)

    if (normalized !== value) {
      set(key, normalized)
    }
  }

  const { properties, required } = schema
  if (properties && typeof properties === 'object' && Array.isArray(required)) {
    const kept = required.filter((name) => !isUndefinableSchema(properties[name], $defs))

    if (kept.length === 0) {
      unset('required')
    } else if (kept.length !== required.length) {
      set('required', kept)
    }
  }

  for (const keyword of ['anyOf', 'oneOf'] as const) {
    const branches = schema[keyword]
    if (!Array.isArray(branches)) {
      continue
    }

    const normalized = (result?.[keyword] ?? branches) as JsonSchema[]
    // a branch matching nothing never changes what the union accepts
    const kept = normalized.filter(
      (branch, i) => !isUndefinedSchema(branches[i]!, $defs) && !isNeverSchema(branch),
    )

    if (kept.length === normalized.length) {
      continue
    }

    if (kept.length === 0) {
      unset(keyword)
      set('not', {})
    } else if (kept.length === 1 && Object.keys(result ?? schema).length === 1) {
      return kept[0]!
    } else {
      set(keyword, kept)
    }
  }

  // replaced last and left as resolved, so a resolver returning non-finite values again can't loop
  return replaceNonFiniteJsonSchemaValues((result as JsonSchema | undefined) ?? schema, options)
}

function normalizeSchemaOrArray(
  value: unknown,
  $defs: Exclude<JsonSchema, boolean>['$defs'],
  options: NormalizeJsonSchemaOptions,
): unknown {
  if (!Array.isArray(value)) {
    return normalizeSchema(value as JsonSchema, $defs, options)
  }

  let result: unknown[] | undefined
  for (let i = 0; i < value.length; i++) {
    const normalized = normalizeSchema(value[i], $defs, options)
    if (normalized !== value[i]) {
      result ??= [...value]
      result[i] = normalized
    }
  }

  return result ?? value
}

function normalizeSchemaRecord(
  value: unknown,
  $defs: Exclude<JsonSchema, boolean>['$defs'],
  options: NormalizeJsonSchemaOptions,
): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }

  let result: Record<string, unknown> | undefined
  for (const [key, item] of Object.entries(value)) {
    // `dependencies` may map a property to a list of required names instead of a schema
    const normalized = normalizeSchemaOrArray(item, $defs, options)
    if (normalized !== item) {
      result ??= { ...value }
      result[key] = normalized
    }
  }

  return result ?? value
}

/**
 * Whether the schema is the marked `undefined` schema, directly or through a root-local `$ref`.
 */
function isUndefinedSchema(
  schema: JsonSchema,
  $defs: Exclude<JsonSchema, boolean>['$defs'],
): boolean {
  const resolved = resolveJsonSchemaRootLocalRef(schema, $defs)
  return typeof resolved === 'object' && JSON_SCHEMA_UNDEFINED_MARKER in resolved
}

/**
 * Whether the schema accepts `undefined`: it is the marked `undefined` schema or has an `anyOf`/`oneOf`
 * branch that accepts it, directly or through root-local `$ref`s.
 */
function isUndefinableSchema(
  schema: JsonSchema | undefined,
  $defs: Exclude<JsonSchema, boolean>['$defs'],
  followedRefs: ReadonlySet<string> = new Set(),
): boolean {
  if (typeof schema !== 'object' || schema === null) {
    return false
  }

  if (typeof schema.$ref === 'string') {
    if (followedRefs.has(schema.$ref)) {
      return false
    }

    followedRefs = new Set(followedRefs).add(schema.$ref)
  }

  const resolved = resolveJsonSchemaRootLocalRef(schema, $defs)
  if (typeof resolved !== 'object') {
    return false
  }

  if (JSON_SCHEMA_UNDEFINED_MARKER in resolved) {
    return true
  }

  return (['anyOf', 'oneOf'] as const).some(
    (keyword) =>
      Array.isArray(resolved[keyword]) &&
      resolved[keyword].some((branch) => isUndefinableSchema(branch, $defs, followedRefs)),
  )
}

/**
 * Whether the schema matches nothing: `false`, or any schema with an empty `not`,
 * since other keywords only narrow it further.
 */
function isNeverSchema(schema: JsonSchema): boolean {
  if (typeof schema === 'boolean') {
    return !schema
  }

  return (
    schema.not === true ||
    (typeof schema.not === 'object' && schema.not !== null && Object.keys(schema.not).length === 0)
  )
}

function isNonFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isFinite(value)
}

function resolveNeverSchema(): JsonSchema {
  return { not: {} }
}
