import type { FileSchema, JSONSchema, ObjectSchema } from './schema'
import { isObject, stringifyJSON } from '@orpc/shared'
import { JSONSchemaTypeName, LOGIC_KEYWORDS } from './schema'

/**
 *@internal
 */
export function isFileSchema(schema: JSONSchema): schema is FileSchema {
  return isObject(schema) && schema.type === 'string' && typeof schema.contentMediaType === 'string'
}

/**
 * @internal
 */
export function isObjectSchema(schema: JSONSchema): schema is ObjectSchema {
  return isObject(schema) && schema.type === 'object'
}

/**
 * @internal
 */
export function isAnySchema(schema: JSONSchema): boolean {
  if (schema === true) {
    return true
  }

  if (
    Object
      .keys(schema)
      .filter(v => schema[v as keyof typeof schema] !== undefined)
      .every(k => !LOGIC_KEYWORDS.includes(k))
  ) {
    return true
  }

  return false
}

export function isNeverSchema(schema: JSONSchema): boolean {
  // Boolean `false` is the shorthand never-schema
  if (schema === false) {
    return true
  }

  if (typeof schema === 'object' && schema.not !== undefined) {
    // `{ not: true }` — negation of the boolean catch-all
    if (schema.not === true) {
      return true
    }

    // `{ not: {} }` — negation of the empty object, which accepts everything
    if (typeof schema.not === 'object' && Object.keys(schema.not).length === 0) {
      return true
    }
  }

  return false
}

/**
 * @internal
 */
export function separateObjectSchema(schema: ObjectSchema, separatedProperties: string[]): [matched: ObjectSchema, rest: ObjectSchema] {
  if (Object.keys(schema).some(
    k => !['type', 'properties', 'required', 'additionalProperties'].includes(k)
      && LOGIC_KEYWORDS.includes(k)
      && (schema as any)[k] !== undefined,
  )) {
    return [{ type: 'object' }, schema]
  }

  const matched: ObjectSchema = { ...schema }
  const rest: ObjectSchema = { ...schema }

  matched.properties = separatedProperties
    .reduce((acc: Record<string, JSONSchema>, key) => {
      const keySchema = schema.properties?.[key] ?? schema.additionalProperties

      if (keySchema !== undefined) {
        acc[key] = keySchema
      }

      return acc
    }, {})

  if (Object.keys(matched.properties).length === 0) {
    matched.properties = undefined
  }

  matched.required = schema.required?.filter(key => separatedProperties.includes(key))

  if (matched.required?.length === 0) {
    matched.required = undefined
  }

  matched.examples = schema.examples?.map((example) => {
    if (!isObject(example)) {
      return example
    }

    return Object.entries(example).reduce((acc, [key, value]) => {
      if (separatedProperties.includes(key)) {
        acc[key] = value
      }

      return acc
    }, {} as Record<string, unknown>)
  })

  rest.properties = schema.properties && Object.entries(schema.properties)
    .filter(([key]) => !separatedProperties.includes(key))
    .reduce((acc: Record<string, JSONSchema> = {}, [key, value]) => {
      acc[key] = value
      return acc
    }, undefined)

  rest.required = schema.required?.filter(key => !separatedProperties.includes(key))

  if (rest.required?.length === 0) {
    rest.required = undefined
  }

  rest.examples = schema.examples?.map((example) => {
    if (!isObject(example)) {
      return example
    }

    return Object.entries(example).reduce((acc, [key, value]) => {
      if (!separatedProperties.includes(key)) {
        acc[key] = value
      }

      return acc
    }, {} as Record<string, unknown>)
  })

  return [matched, rest]
}

/**
 * @internal
 */
export function filterSchemaBranches(
  schema: JSONSchema,
  check: (schema: JSONSchema) => boolean,
  matches: JSONSchema[] = [],
): [matches: JSONSchema[], rest: JSONSchema | undefined] {
  if (check(schema)) {
    matches.push(schema)
    return [matches, undefined]
  }
  if (isObject(schema)) {
    for (const keyword of ['anyOf', 'oneOf'] as const) {
      if (schema[keyword] && Object.keys(schema).every(
        k => k === keyword || !LOGIC_KEYWORDS.includes(k),
      )) {
        const rest = schema[keyword]
          .map(s => filterSchemaBranches(s, check, matches)[1])
          .filter(v => !!v)

        if (rest.length === 1 && typeof rest[0] === 'object') {
          return [matches, { ...schema, [keyword]: undefined, ...rest[0] }]
        }

        return [matches, { ...schema, [keyword]: rest }]
      }
    }
  }

  return [matches, schema]
}

export function applySchemaOptionality(required: boolean, schema: JSONSchema): JSONSchema {
  if (required) {
    return schema
  }

  return {
    anyOf: [
      schema,
      { not: {} },
    ],
  }
}

/**
 * Takes a JSON schema and, if it's primarily a union type (anyOf, oneOf),
 * recursively expands it into an array of its constituent, non-union base schemas.
 * If the schema is not a simple union or is a base type, it's returned as a single-element array.
 */
export function expandUnionSchema(schema: JSONSchema): JSONSchema[] {
  if (typeof schema === 'object') {
    for (const keyword of ['anyOf', 'oneOf'] as const) {
      if (schema[keyword] && Object.keys(schema).every(
        k => k === keyword || !LOGIC_KEYWORDS.includes(k),
      )) {
        return schema[keyword].flatMap(s => expandUnionSchema(s))
      }
    }
  }

  return [schema]
}

export function expandArrayableSchema(schema: JSONSchema): undefined | [items: JSONSchema, array: JSONSchema & { type: 'array', items?: JSONSchema }] {
  const schemas = expandUnionSchema(schema)

  if (schemas.length !== 2) {
    return undefined
  }

  const arraySchema = schemas.find(
    s => typeof s === 'object' && s.type === 'array' && Object.keys(s).filter(k => LOGIC_KEYWORDS.includes(k)).every(k => k === 'type' || k === 'items'),
  ) as JSONSchema & { type: 'array', items?: JSONSchema }

  if (arraySchema === undefined) {
    return undefined
  }

  const items1 = arraySchema.items
  const items2 = schemas.find(s => s !== arraySchema) as JSONSchema

  if (stringifyJSON(items1) !== stringifyJSON(items2)) {
    return undefined
  }

  return [items2, arraySchema]
}

const PRIMITIVE_SCHEMA_TYPES = new Set<string>([
  JSONSchemaTypeName.String,
  JSONSchemaTypeName.Number,
  JSONSchemaTypeName.Integer,
  JSONSchemaTypeName.Boolean,
  JSONSchemaTypeName.Null,
])

export function isPrimitiveSchema(schema: JSONSchema): boolean {
  return expandUnionSchema(schema).every((s) => {
    if (typeof s === 'boolean') {
      return false
    }

    if (typeof s.type === 'string' && PRIMITIVE_SCHEMA_TYPES.has(s.type)) {
      return true
    }

    if (s.const !== undefined) {
      return true
    }

    return false
  })
}
