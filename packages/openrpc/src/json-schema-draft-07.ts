import type { JsonSchema } from '@orpc/json-schema'
import { getOwn, isPlainObject, setOwn } from '@orpc/shared'

type JsonSchemaRecord = Record<string, unknown>

/**
 * Keywords whose value is a single schema.
 */
const SCHEMA_KEYWORDS = new Set([
  'additionalItems',
  'additionalProperties',
  'contains',
  'else',
  'if',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
])

/**
 * Keywords whose value is an array of schemas.
 */
const SCHEMA_ARRAY_KEYWORDS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])

/**
 * Keywords whose value maps names to schemas.
 */
const SCHEMA_MAP_KEYWORDS = new Set(['$defs', 'definitions', 'patternProperties', 'properties'])

/**
 * The draft 2020-12 keywords merged into the draft-07 `dependencies` keyword, in merge order.
 */
const DEPENDENCY_KEYWORDS = ['dependencies', 'dependentRequired', 'dependentSchemas'] as const

/**
 * Lowers a draft 2020-12 JSON Schema, as produced by oRPC's converters, to the JSON Schema draft-07 that OpenRPC 1.x
 * documents use:
 *
 * - `prefixItems` (+ `items`) become `items` (+ `additionalItems`).
 * - `dependentRequired` and `dependentSchemas` become `dependencies`, a name in both is combined with `allOf`.
 * - A `$ref` with sibling keywords moves into `allOf`, since draft-07 ignores the siblings of `$ref`.
 * - `$schema` is removed.
 *
 * Every other keyword is kept: draft-07 tools ignore unknown keywords, and pointers into nested `$defs`
 * still resolve structurally. The input is never mutated, and lowering a lowered schema changes nothing.
 */
export function toDraft07JsonSchema(schema: JsonSchema): JsonSchema {
  return lowerSchema(schema, new WeakMap()) as JsonSchema
}

/**
 * `seen` maps each visited schema object to its lowered copy, so shared and cyclic subschemas
 * are lowered once and keep their shape.
 */
function lowerSchema(schema: unknown, seen: WeakMap<object, JsonSchemaRecord>): unknown {
  // boolean schemas and anything that is not a schema object have nothing to lower
  if (!isPlainObject(schema)) {
    return schema
  }

  const cached = seen.get(schema)

  if (cached !== undefined) {
    return cached
  }

  const lowered: JsonSchemaRecord = {}
  seen.set(schema, lowered)

  // a draft-07 `items` array can only carry the tuple when `items` is a single schema (or absent)
  const tuple = Array.isArray(getOwn(schema, 'prefixItems')) && !Array.isArray(getOwn(schema, 'items'))
  const tupleRest = tuple ? getOwn(schema, 'items') : undefined
  const ref = getOwn(schema, '$ref')
  const wrapRef = typeof ref === 'string' && hasRefSiblings(schema)
  let dependenciesLowered = false

  if (wrapRef) {
    setOwn(lowered, 'allOf', [{ $ref: ref }])
  }

  for (const key of Object.keys(schema)) {
    const value = schema[key]

    if (key === '$schema' || (wrapRef && key === '$ref')) {
      continue
    }

    if (wrapRef && key === 'allOf') {
      (lowered.allOf as unknown[]).push(...(lowerSchemaArray(value, seen) as unknown[]))
      continue
    }

    if (tuple && key === 'prefixItems') {
      setOwn(lowered, 'items', lowerSchemaArray(value, seen))

      if (tupleRest !== undefined) {
        setOwn(lowered, 'additionalItems', lowerSchema(tupleRest, seen))
      }

      continue
    }

    if (tuple && (key === 'items' || (key === 'additionalItems' && tupleRest !== undefined))) {
      continue // written with `prefixItems`
    }

    if ((DEPENDENCY_KEYWORDS as readonly string[]).includes(key) && isPlainObject(value)) {
      if (!dependenciesLowered) {
        dependenciesLowered = true
        setOwn(lowered, 'dependencies', lowerDependencies(schema, seen))
      }

      continue
    }

    if (key === 'items') {
      setOwn(lowered, key, Array.isArray(value) ? lowerSchemaArray(value, seen) : lowerSchema(value, seen))
    }
    else if (SCHEMA_KEYWORDS.has(key)) {
      setOwn(lowered, key, lowerSchema(value, seen))
    }
    else if (SCHEMA_ARRAY_KEYWORDS.has(key)) {
      setOwn(lowered, key, lowerSchemaArray(value, seen))
    }
    else if (SCHEMA_MAP_KEYWORDS.has(key)) {
      setOwn(lowered, key, lowerSchemaMap(value, seen))
    }
    else {
      setOwn(lowered, key, value)
    }
  }

  return lowered
}

function lowerSchemaArray(value: unknown, seen: WeakMap<object, JsonSchemaRecord>): unknown {
  return Array.isArray(value) ? value.map(item => lowerSchema(item, seen)) : value
}

function lowerSchemaMap(value: unknown, seen: WeakMap<object, JsonSchemaRecord>): unknown {
  if (!isPlainObject(value)) {
    return value
  }

  const lowered: JsonSchemaRecord = {}

  for (const name of Object.keys(value)) {
    setOwn(lowered, name, lowerSchema(value[name], seen))
  }

  return lowered
}

/**
 * Merges `dependencies`, `dependentRequired`, and `dependentSchemas` into one draft-07 `dependencies` map.
 * A property named in several of them gets the `allOf` of its entries, a property list becoming `{ required }`.
 */
function lowerDependencies(schema: JsonSchemaRecord, seen: WeakMap<object, JsonSchemaRecord>): JsonSchemaRecord {
  const merged: JsonSchemaRecord = {}

  for (const keyword of DEPENDENCY_KEYWORDS) {
    const dependencies = getOwn(schema, keyword)

    if (!isPlainObject(dependencies)) {
      continue
    }

    for (const name of Object.keys(dependencies)) {
      const dependency = dependencies[name]

      if (dependency === undefined) {
        continue
      }

      const lowered = Array.isArray(dependency) ? [...dependency] : lowerSchema(dependency, seen)
      const existing = getOwn(merged, name)

      setOwn(merged, name, existing === undefined
        ? lowered
        : { allOf: [toDependencySchema(existing), toDependencySchema(lowered)] })
    }
  }

  return merged
}

function toDependencySchema(dependency: unknown): unknown {
  return Array.isArray(dependency) ? { required: dependency } : dependency
}

/**
 * Draft-07 ignores every keyword next to `$ref`, so a `$ref` with siblings is moved into `allOf`:
 * `{ $ref, ...rest }` becomes `{ allOf: [{ $ref }], ...rest }`. An existing `allOf` array is extended,
 * a malformed one leaves the schema as is.
 */
function hasRefSiblings(schema: JsonSchemaRecord): boolean {
  const allOf = getOwn(schema, 'allOf')

  if (allOf !== undefined && !Array.isArray(allOf)) {
    return false
  }

  return Object.keys(schema).some(key => key !== '$ref' && key !== '$schema' && schema[key] !== undefined)
}
