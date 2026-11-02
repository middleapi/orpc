/**
 * These utilities assume the schema has only one root-level `$defs` object
 * and exclusively use absolute JSON pointers for `$ref` values.
 */

import type { JsonSchema } from './types'
import { JSON_SCHEMA_LOGIC_KEYWORDS, JSON_SCHEMA_PRIMITIVE_TYPES, JSON_SCHEMA_RECORD_KEYWORDS } from './constants'
import { resolveJsonSchemaLocalPointer } from './ref-utils'

/**
 * Returns true when the schema describes a primitive value (a primitive `type`, `const`, or `enum`).
 * `$ref`s are not followed: resolve them first, e.g. with `resolveJsonSchemaRootLocalRef`.
 */
export function isJsonPrimitiveSchema(schema: JsonSchema): schema is JsonSchema & object {
  if (typeof schema === 'boolean') {
    return false
  }

  if (typeof schema.type === 'string' && JSON_SCHEMA_PRIMITIVE_TYPES.has(schema.type)) {
    return true
  }

  if (schema.const !== undefined) {
    return true
  }

  if (schema.enum !== undefined) {
    return true
  }

  return false
}

export type JsonFileSchema = JsonSchema & object & { type: 'string', contentMediaType?: string }

/**
 * Returns true when the schema is a file-like string schema.
 * `$ref`s are not followed: resolve them first, e.g. with `resolveJsonSchemaRootLocalRef`.
 */
export function isJsonFileSchema(schema: JsonSchema): schema is JsonFileSchema {
  return typeof schema !== 'boolean' && schema.type === 'string' && (typeof schema.contentMediaType === 'string' || schema.format === 'binary' || schema.contentEncoding === 'binary')
}

/**
 * Returns true when a file schema is reachable from the schema, such as through a property, a composition, or a local `$ref`.
 * Definitions are only inspected when a `$ref` reaches them, so unused `$defs` entries are ignored.
 */
export function containsJsonFileSchema(schema: JsonSchema): boolean {
  // shared targets and recursive refs resolve to already seen objects, which ends the walk
  const seen = new Set<object>()

  const visit = (value: unknown, schemaLevel: boolean): boolean => {
    if (!value || typeof value !== 'object' || seen.has(value)) {
      return false
    }

    seen.add(value)

    if (Array.isArray(value)) {
      return value.some(item => visit(item, schemaLevel))
    }

    const record = value as Record<string, unknown>

    if (schemaLevel && isJsonFileSchema(record as JsonSchema)) {
      return true
    }

    return Object.keys(record).some((key) => {
      const val = record[key]

      if (key === '$ref' && typeof val === 'string') {
        return visit(resolveJsonSchemaLocalPointer(schema, val), true)
      }

      if (!schemaLevel) {
        return visit(val, true)
      }

      // definitions are only reachable through refs
      return key !== '$defs'
        && (JSON_SCHEMA_LOGIC_KEYWORDS.has(key) || JSON_SCHEMA_RECORD_KEYWORDS.has(key))
        && visit(val, !JSON_SCHEMA_RECORD_KEYWORDS.has(key))
    })
  }

  return visit(schema, true)
}

export type JsonObjectSchema = JsonSchema & object & { type: 'object' }

/**
 * Returns true when the schema is an object schema.
 */
export function isJsonObjectSchema(schema: JsonSchema): schema is JsonObjectSchema {
  return typeof schema !== 'boolean' && schema.type === 'object'
}

export type JsonArraySchema = JsonSchema & object & { type: 'array' }

/**
 * Returns true when the schema is an array schema.
 */
export function isJsonArraySchema(schema: JsonSchema): schema is JsonArraySchema {
  return typeof schema !== 'boolean' && schema.type === 'array'
}

/**
 * Returns true when the schema does not apply any recognized constraints.
 */
export function isUnconstrainedSchema(schema: JsonSchema): boolean {
  if (typeof schema === 'boolean') {
    return schema
  }

  if (Object.keys(schema).every(k => !JSON_SCHEMA_LOGIC_KEYWORDS.has(k))) {
    return true
  }

  return false
}

/**
 * Ensures a JSON Schema is represented as an object schema document.
 */
export function ensureJsonSchemaObject(schema: JsonSchema): Exclude<JsonSchema, boolean> {
  if (typeof schema === 'boolean') {
    return schema ? {} : { not: {} }
  }

  return schema
}
