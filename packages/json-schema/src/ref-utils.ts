/**
 * These utilities assume the schema has only one root-level `$defs` object
 * and exclusively use absolute JSON pointers for `$ref` values.
 */

import type { JsonSchema } from './types'
import { get } from '@orpc/shared'
import { JSON_SCHEMA_LOGIC_KEYWORDS, JSON_SCHEMA_RECORD_KEYWORDS } from './constants'

/**
 * Encodes a JSON Pointer segment according to RFC 6901.
 *
 * https://datatracker.ietf.org/doc/html/rfc6901
 */
export function encodeJsonPointerSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1')
}

/**
 * Decodes a JSON Pointer segment according to RFC 6901.
 *
 * https://datatracker.ietf.org/doc/html/rfc6901
 */
export function decodeJsonPointerSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~')
}

export function mapJsonSchemaRefs(
  value: JsonSchema,
  map: (ref: string, path: Array<string | number>) => string,
  schemaLevel = true,
  path: Array<string | number> = [],
): JsonSchema {
  if (!value || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => mapJsonSchemaRefs(item, map, schemaLevel, [...path, index])) as any
  }

  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value)) {
    if (key === '$ref' && typeof val === 'string') {
      result[key] = map(val, [...path, key])
    }
    else if (!schemaLevel) {
      result[key] = mapJsonSchemaRefs(val as JsonSchema, map, true, [...path, key])
    }
    else if (JSON_SCHEMA_LOGIC_KEYWORDS.has(key) || JSON_SCHEMA_RECORD_KEYWORDS.has(key)) {
      result[key] = mapJsonSchemaRefs(val as JsonSchema, map, !JSON_SCHEMA_RECORD_KEYWORDS.has(key), [...path, key])
    }
    else {
      result[key] = val
    }
  }

  return result as JsonSchema
}

/**
 * Rewrites recursive root `#` refs by moving the schema body into `$defs`.
 */
export function hoistRecursiveRefToDef(schema: JsonSchema): JsonSchema {
  if (typeof schema !== 'object') {
    return schema
  }

  let defName: string | undefined

  const rewritten = mapJsonSchemaRefs(schema, (ref) => {
    if (ref === '#' || (ref.startsWith('#/') && !ref.startsWith('#/$defs/') && get(schema, ref.slice(2).split('/').map(decodeJsonPointerSegment)) !== undefined)) {
      defName ??= findRecursiveJsonSchemaDefName(schema.$defs)
      return `#/$defs/${encodeJsonPointerSegment(defName)}${ref.slice(1)}`
    }

    return ref
  })

  if (defName === undefined) {
    return schema
  }

  const { $defs, ...rest } = rewritten as Exclude<typeof rewritten, boolean>

  return {
    $ref: `#/$defs/${encodeJsonPointerSegment(defName)}`,
    $defs: {
      ...$defs,
      [defName]: rest,
    },
  }
}

/**
 * Resolves a local `$ref` at the **root level** of the given schema, if present.
 *
 * Only handles refs of the form `#/$defs/<name>` pointing into the provided
 * (or schema-embedded) `$defs` map. Nested `$ref`s inside sub-schemas are
 * intentionally left untouched.
 *
 * If the ref cannot be resolved (missing `$defs`, unknown key, etc.) the
 * schema is returned as-is.
 *
 * @param schema - The schema whose root-level `$ref` should be resolved.
 * @param $defs - Definition map to resolve against. If omitted, falls back to
 *   `schema.$defs`. When provided, takes precedence over any `$defs` embedded
 *   in the schema.
 */
export function resolveJsonSchemaRootLocalRef(
  schema: JsonSchema,
  $defs?: Exclude<JsonSchema, boolean>['$defs'],
): JsonSchema {
  if (typeof schema === 'boolean') {
    return schema
  }

  if (arguments.length === 1) {
    $defs = schema.$defs
  }

  if (!$defs) {
    return schema
  }

  if (typeof schema.$ref !== 'string' || !schema.$ref.startsWith('#/$defs/')) {
    return schema
  }

  const resolved = get($defs, schema.$ref.slice('#/$defs/'.length).split('/').map(decodeJsonPointerSegment)) as JsonSchema | undefined

  if (resolved === undefined) {
    return schema
  }

  if (typeof resolved !== 'object') {
    return resolved
  }

  const { $ref: _ref, ...rest } = schema
  return resolveJsonSchemaRootLocalRef({
    ...rest,
    ...resolved,
  })
}

function findRecursiveJsonSchemaDefName(defs: Exclude<JsonSchema, boolean>['$defs'] | undefined): string {
  let index = 0

  while (defs?.[`__schema${index}`] !== undefined) {
    index++
  }

  return `__schema${index}`
}
