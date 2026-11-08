import type { JsonSchema } from '@orpc/json-schema'
import { setOwn, stringifyJSON } from '@orpc/shared'

import type { ObjectJsonSchema } from './schema-utils.ts'
import { collectDefRefs, fromRef, isPlain } from './schema-utils.ts'

/**
 * What an inferred schema adds to the schemas a converter produced for the same value,
 * `undefined` when it adds nothing. Returns the schema itself when nothing was removed.
 */
export function withoutDescribedSchemas(
  schema: JsonSchema,
  described: readonly JsonSchema[],
): JsonSchema | undefined {
  const rest = described.reduce(
    (current, other) => withoutDescribed(current, other, getDefsResolver(other)),
    schema,
  )

  if (rest === schema) {
    return schema
  }

  const pruned = withoutUnusedDefs(rest)
  return isPlain(pruned, 'object') ? undefined : pruned
}

/**
 * Removes the properties of an object schema that another schema describes as well,
 * keeping what only it adds (`b` of `{ query: { a, b } }` when the other has `{ query: { a } }`).
 */
function withoutDescribed(
  schema: JsonSchema,
  described: JsonSchema,
  resolve: (schema: JsonSchema) => JsonSchema,
): JsonSchema {
  described = resolve(described)

  if (
    typeof schema !== 'object' ||
    typeof described !== 'object' ||
    !schema.properties ||
    !described.properties
  ) {
    return schema
  }

  const properties: Record<string, JsonSchema> = {}
  const removed = new Set<string>()
  let changed = false

  for (const [name, property] of Object.entries(schema.properties)) {
    const other = described.properties[name]

    if (other === undefined) {
      setOwn(properties, name, property)
      continue
    }

    const rest = isCovered(property, resolve(other))
      ? undefined
      : withoutDescribed(property, other, resolve)

    if (rest === undefined || (rest !== property && isPlain(rest, 'object'))) {
      removed.add(name)
    } else {
      setOwn(properties, name, rest)
      changed ||= rest !== property
    }
  }

  if (!removed.size && !changed) {
    return schema
  }

  // a key the type requires stays required, unless the other schema requires it already
  const required = schema.required?.filter(
    (name) => !removed.has(name) || !described.required?.includes(name),
  )
  const rest: ObjectJsonSchema = { ...schema }
  delete rest.properties
  delete rest.required

  return {
    ...rest,
    ...(Object.keys(properties).length ? { properties } : {}),
    ...(required?.length ? { required } : {}),
  }
}

/**
 * Resolves refs of a converted schema into its own `$defs` (zod's `.meta({ id })`),
 * to compare what they describe.
 */
function getDefsResolver(root: JsonSchema): (schema: JsonSchema) => JsonSchema {
  const $defs = typeof root === 'object' ? root.$defs : undefined

  if (!$defs) {
    return (schema) => schema
  }

  return (schema) => {
    // a ref to a ref, at most a few times
    for (let depth = 0; depth < 8; depth++) {
      const name = fromRef(schema)

      if (name === undefined || !Object.hasOwn($defs, name)) {
        break
      }

      schema = $defs[name]!
    }

    return schema
  }
}

/**
 * Whether a schema adds nothing to another: it is `{}`, or says nothing the other does not,
 * like `{ type: 'string' }` next to `{ type: 'string', minLength: 3 }`. Refs point into
 * different `$defs`, so a schema with a ref is never covered.
 */
function isCovered(schema: JsonSchema, other: JsonSchema): boolean {
  if (typeof schema !== 'object') {
    return schema
  }

  if (!Object.keys(schema).length) {
    return true
  }

  if (typeof other !== 'object' || stringifyJSON(schema)!.includes('"$ref"')) {
    return false
  }

  const normalized = normalize(schema) as ObjectJsonSchema
  const otherNormalized = normalize(other) as ObjectJsonSchema

  return Object.keys(normalized).every((key) => {
    const value = (normalized as any)[key]
    const otherValue = (otherNormalized as any)[key]

    if (key === 'type' && value === 'number') {
      return otherValue === 'number' || otherValue === 'integer'
    }

    return stringifyJSON(value) === stringifyJSON(otherValue)
  })
}

/**
 * A schema with its values in a canonical order: `const` as a one-value `enum`, enum values
 * without duplicates and sorted, and `anyOf` branches sorted, so equal schemas written
 * differently (`z.enum(['b', 'a'])` and `'a' | 'b'`) compare equal.
 */
function normalize(schema: JsonSchema): JsonSchema {
  if (typeof schema !== 'object') {
    return schema
  }

  const normalized: Record<string, unknown> = { ...schema }

  if (normalized.const !== undefined && normalized.enum === undefined) {
    normalized.enum = [normalized.const]
    delete normalized.const
  }

  if (Array.isArray(normalized.enum)) {
    normalized.enum = sortedUnique(normalized.enum)
  }

  if (Array.isArray(normalized.anyOf)) {
    normalized.anyOf = sortedUnique((normalized.anyOf as JsonSchema[]).map(normalize))
  }

  return normalized as JsonSchema
}

function sortedUnique(values: readonly unknown[]): unknown[] {
  const byKey = new Map(values.map((value) => [stringifyJSON(value), value]))
  return (
    [...byKey.keys()]
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a copy
      .sort((a, b) => (a! < b! ? -1 : a! > b! ? 1 : 0))
      .map((key) => byKey.get(key))
  )
}

/**
 * Adds to a converted schema the keys the inferred schemas require, which the converted
 * schema leaves optional (`z.object({ a: z.string().optional() })` next to `{ a: string }`),
 * also in nested objects. Returns the schema itself when nothing changes.
 */
export function withRequiredFrom(schema: JsonSchema, inferred: readonly JsonSchema[]): JsonSchema {
  if (typeof schema !== 'object' || !schema.properties) {
    return schema
  }

  const objects = inferred.filter(
    (other): other is ObjectJsonSchema => typeof other === 'object' && !!other.properties,
  )
  const required = new Set(schema.required)
  const properties: Record<string, JsonSchema> = {}
  let changed = false

  for (const [name, property] of Object.entries(schema.properties)) {
    if (objects.some((other) => other.required?.includes(name)) && !required.has(name)) {
      required.add(name)
      changed = true
    }

    const nested = withRequiredFrom(
      property,
      objects.flatMap((other) =>
        other.properties![name] === undefined ? [] : [other.properties![name]!],
      ),
    )
    changed ||= nested !== property
    setOwn(properties, name, nested)
  }

  return changed ? { ...schema, properties, required: [...required] } : schema
}

/**
 * Removes the `$defs` nothing references anymore.
 */
function withoutUnusedDefs(schema: JsonSchema): JsonSchema {
  if (typeof schema !== 'object' || !schema.$defs) {
    return schema
  }

  const $defs = schema.$defs
  const root: ObjectJsonSchema = { ...schema }
  delete root.$defs

  const used = new Set<string>()
  const queue = [...collectDefRefs(root)]

  while (queue.length) {
    const name = queue.pop()!

    if (!used.has(name) && Object.hasOwn($defs, name)) {
      used.add(name)
      queue.push(...collectDefRefs($defs[name]!))
    }
  }

  const kept = Object.fromEntries(Object.entries($defs).filter(([name]) => used.has(name)))
  return Object.keys(kept).length ? { ...root, $defs: kept } : root
}
