import type { HTTPMethod, HTTPPath } from '@orpc/client'
import type { OpenAPI } from '@orpc/contract'
import type { FileSchema, JSONSchema, ObjectSchema } from './schema'
import { standardizeHTTPPath } from '@orpc/openapi-client/standard'
import { findDeepMatches, isObject, stringifyJSON, toArray } from '@orpc/shared'
import { expandArrayableSchema, filterSchemaBranches, isFileSchema, isObjectSchema, isPrimitiveSchema } from './schema-utils'

/**
 * @internal
 */
export function toOpenAPIPath(path: HTTPPath): string {
  return standardizeHTTPPath(path).replace(/\/\{\+([^}]+)\}/g, '/{$1}')
}

/**
 * @internal
 */
export function toOpenAPIMethod(method: HTTPMethod): Lowercase<HTTPMethod> {
  return method.toLocaleLowerCase() as Lowercase<HTTPMethod>
}

/**
 * @internal
 */
export function toOpenAPIContent(schema: JSONSchema): Record<string, OpenAPI.MediaTypeObject> {
  const content: Record<string, OpenAPI.MediaTypeObject> = {}

  const [matches, restSchema] = filterSchemaBranches(schema, isFileSchema)

  for (const file of matches as FileSchema[]) {
    content[file.contentMediaType] = {
      schema: toOpenAPISchema(file),
    }
  }

  if (restSchema !== undefined) {
    content['application/json'] = {
      schema: toOpenAPISchema(restSchema),
    }

    const isStillHasFileSchema = findDeepMatches(v => isObject(v) && isFileSchema(v), restSchema).values.length > 0

    if (isStillHasFileSchema) {
      content['multipart/form-data'] = {
        schema: toOpenAPISchema(restSchema),
      }
    }
  }

  return content
}

/**
 * @internal
 */
export function toOpenAPIEventIteratorContent(
  [yieldsRequired, yieldsSchema]: [boolean, JSONSchema],
  [returnsRequired, returnsSchema]: [boolean, JSONSchema],
): Record<string, OpenAPI.MediaTypeObject> {
  return {
    'text/event-stream': {
      schema: toOpenAPISchema({
        oneOf: [
          {
            type: 'object',
            properties: {
              event: { const: 'message' },
              data: yieldsSchema,
              id: { type: 'string' },
              retry: { type: 'number' },
            },
            required: yieldsRequired ? ['event', 'data'] : ['event'],
          },
          {
            type: 'object',
            properties: {
              event: { const: 'done' },
              data: returnsSchema,
              id: { type: 'string' },
              retry: { type: 'number' },
            },
            required: returnsRequired ? ['event', 'data'] : ['event'],
          },
          {
            type: 'object',
            properties: {
              event: { const: 'error' },
              data: {},
              id: { type: 'string' },
              retry: { type: 'number' },
            },
            required: ['event'],
          },
        ],
      }),
    },
  }
}

/**
 * @internal
 */
export function toOpenAPIParameters(schema: ObjectSchema, parameterIn: 'path' | 'query' | 'header' | 'cookie'): OpenAPI.ParameterObject[] {
  const parameters: OpenAPI.ParameterObject[] = []

  for (const key in schema.properties) {
    const keySchema = schema.properties[key]!

    let isDeepObjectStyle = true

    if (parameterIn !== 'query') {
      isDeepObjectStyle = false
    }
    else if (isPrimitiveSchema(keySchema)) {
      isDeepObjectStyle = false
    }
    else {
      const [item] = expandArrayableSchema(keySchema) ?? []

      if (item !== undefined && isPrimitiveSchema(item)) {
        isDeepObjectStyle = false
      }
    }

    parameters.push({
      name: key,
      in: parameterIn,
      required: schema.required?.includes(key),
      schema: toOpenAPISchema(keySchema) as any,
      style: isDeepObjectStyle ? 'deepObject' : undefined,
      explode: isDeepObjectStyle ? true : undefined,
      allowEmptyValue: parameterIn === 'query' ? true : undefined,
      allowReserved: parameterIn === 'query' ? true : undefined,
    })
  }

  return parameters
}

/**
 * @internal
 */
export function checkParamsSchema(schema: ObjectSchema, params: string[]): boolean {
  const properties = Object.keys(schema.properties ?? {})
  const required = schema.required ?? []

  if (properties.length !== params.length || properties.some(v => !params.includes(v))) {
    return false
  }

  if (required.length !== params.length || required.some(v => !params.includes(v))) {
    return false
  }

  return true
}

/**
 * @internal
 */
export function toOpenAPISchema(schema: JSONSchema): OpenAPI.SchemaObject & object {
  return schema === true
    ? {}
    : schema === false
      ? { not: {} }
      : schema as OpenAPI.SchemaObject
}

const OPENAPI_JSON_SCHEMA_REF_PREFIX = /* @__PURE__ */ '#/components/schemas/'

export function resolveOpenAPIJsonSchemaRef(doc: OpenAPI.Document, schema: JSONSchema): JSONSchema {
  if (typeof schema !== 'object' || !schema.$ref?.startsWith(OPENAPI_JSON_SCHEMA_REF_PREFIX)) {
    return schema
  }

  const name = schema.$ref.slice(OPENAPI_JSON_SCHEMA_REF_PREFIX.length)
  const resolved = doc.components?.schemas?.[name]
  return resolved as JSONSchema ?? schema
}

/**
 * Simplifies composed object JSON Schemas (using anyOf, oneOf, allOf) by flattening nested compositions
 *
 * @warning The result is looser than the original schema and may not fully validate the same data.
 */
export function simplifyComposedObjectJsonSchemasAndRefs(schema: JSONSchema, doc?: OpenAPI.Document): JSONSchema {
  if (doc) {
    schema = resolveOpenAPIJsonSchemaRef(doc, schema)
  }

  if (typeof schema !== 'object' || (!schema.anyOf && !schema.oneOf && !schema.allOf)) {
    return schema
  }

  const unionSchemas = [
    ...toArray(schema.anyOf?.map(s => simplifyComposedObjectJsonSchemasAndRefs(s, doc))),
    ...toArray(schema.oneOf?.map(s => simplifyComposedObjectJsonSchemasAndRefs(s, doc))),
  ]
  const objectUnionSchemas: ObjectSchema[] = []
  for (const u of unionSchemas) {
    if (!isObjectSchema(u)) {
      return schema
    }

    objectUnionSchemas.push(u)
  }

  const mergedUnionPropertyMap: Map<string, { required: boolean, schemas: JSONSchema[] }> = new Map()
  for (const u of objectUnionSchemas) {
    if (u.properties) {
      for (const [key, value] of Object.entries(u.properties)) {
        let entry = mergedUnionPropertyMap.get(key)
        if (!entry) {
          const required = objectUnionSchemas.every(s => s.required?.includes(key))

          entry = { required, schemas: [] }
          mergedUnionPropertyMap.set(key, entry)
        }
        entry.schemas.push(value)
      }
    }
  }

  const intersectionSchemas = toArray(schema.allOf?.map(s => simplifyComposedObjectJsonSchemasAndRefs(s, doc)))
  const objectIntersectionSchemas: ObjectSchema[] = []
  for (const u of intersectionSchemas) {
    if (!isObjectSchema(u)) {
      return schema
    }

    objectIntersectionSchemas.push(u)
  }

  // if object schema in the same level with anyOf/oneOf/allOf
  if (isObjectSchema(schema)) {
    objectIntersectionSchemas.push(schema)
  }

  const mergedInteractionPropertyMap: Map<string, { required: boolean, schemas: JSONSchema[] }> = new Map()
  for (const u of objectIntersectionSchemas) {
    if (u.properties) {
      for (const [key, value] of Object.entries(u.properties)) {
        let entry = mergedInteractionPropertyMap.get(key)
        if (!entry) {
          const required = objectIntersectionSchemas.some(s => s.required?.includes(key))

          entry = { required, schemas: [] }
          mergedInteractionPropertyMap.set(key, entry)
        }

        entry.schemas.push(value)
      }
    }
  }

  const resultObjectSchema: { type: 'object', properties: Record<string, JSONSchema>, required: string[] } = { type: 'object', properties: {}, required: [] }
  const keys = new Set<string>([
    ...mergedUnionPropertyMap.keys(),
    ...mergedInteractionPropertyMap.keys(),
  ])
  if (keys.size === 0) {
    return schema
  }

  const deduplicateSchemas = (schemas: JSONSchema[]): JSONSchema[] => {
    const seen = new Set<string>()
    const result: JSONSchema[] = []
    for (const schema of schemas) {
      const key = stringifyJSON(schema)
      if (!seen.has(key)) {
        seen.add(key)
        result.push(schema)
      }
    }
    return result
  }

  for (const key of keys) {
    const unionEntry = mergedUnionPropertyMap.get(key)
    const intersectionEntry = mergedInteractionPropertyMap.get(key)

    resultObjectSchema.properties[key] = (() => {
      const dedupedUnionSchemas = unionEntry ? deduplicateSchemas(unionEntry.schemas) : []
      const dedupedIntersectionSchemas = intersectionEntry ? deduplicateSchemas(intersectionEntry.schemas) : []

      if (!dedupedUnionSchemas.length) {
        return dedupedIntersectionSchemas.length === 1
          ? dedupedIntersectionSchemas[0]!
          : { allOf: dedupedIntersectionSchemas }
      }

      if (!dedupedIntersectionSchemas.length) {
        return dedupedUnionSchemas.length === 1
          ? dedupedUnionSchemas[0]!
          : { anyOf: dedupedUnionSchemas }
      }

      const allOf = deduplicateSchemas([
        ...dedupedIntersectionSchemas,
        dedupedUnionSchemas.length === 1
          ? dedupedUnionSchemas[0]!
          : { anyOf: dedupedUnionSchemas },
      ])

      return allOf.length === 1
        ? allOf[0]!
        : { allOf }
    })()

    if (unionEntry?.required || intersectionEntry?.required) {
      resultObjectSchema.required.push(key)
    }
  }

  return resultObjectSchema
}
