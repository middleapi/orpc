import type { JsonSchema } from '@orpc/json-schema'
import { JsonSchemaFormat, JsonSchemaXNativeType, visitJsonSchemaRefs } from '@orpc/json-schema'
import { stringifyJSON } from '@orpc/shared'
import type { JSDocTagInfo } from 'typescript/unstable/sync'

export type ObjectJsonSchema = Exclude<JsonSchema, boolean>

export const DEFS_REF_PREFIX = '#/$defs/'

export function toRef(name: string): string {
  return `${DEFS_REF_PREFIX}${name.replace(/~/gu, '~0').replace(/\//gu, '~1')}`
}

/**
 * The def name of a schema that is only a `$ref` to a local def.
 */
export function fromRef(schema: JsonSchema): string | undefined {
  if (
    typeof schema !== 'object' ||
    typeof schema.$ref !== 'string' ||
    Object.keys(schema).length !== 1 ||
    !schema.$ref.startsWith(DEFS_REF_PREFIX)
  ) {
    return undefined
  }

  return decodeDefName(schema.$ref.slice(DEFS_REF_PREFIX.length))
}

/**
 * The names of the local defs a schema refers to directly.
 */
export function collectDefRefs(schema: JsonSchema): Set<string> {
  const names = new Set<string>()

  visitJsonSchemaRefs(schema, (ref) => {
    if (ref.startsWith(DEFS_REF_PREFIX)) {
      names.add(decodeDefName(ref.slice(DEFS_REF_PREFIX.length).split('/')[0]!))
    }
  })

  return names
}

function decodeDefName(segment: string): string {
  return segment.replace(/~1/gu, '/').replace(/~0/gu, '~')
}

export function bigintSchema(): ObjectJsonSchema {
  return {
    'type': 'string',
    'pattern': '^-?[0-9]+$',
    'x-native-type': JsonSchemaXNativeType.BigInt,
  }
}

/**
 * Schemas of built-in values without type arguments, as the OpenAPI JSON serializer emits them.
 */
export function getLeafBuiltinSchema(name: string): ObjectJsonSchema | undefined {
  switch (name) {
    case 'Date':
      return {
        'type': 'string',
        'format': JsonSchemaFormat.DateTime,
        'x-native-type': JsonSchemaXNativeType.Date,
      }
    case 'URL':
      return {
        'type': 'string',
        'format': JsonSchemaFormat.URI,
        'x-native-type': JsonSchemaXNativeType.Url,
      }
    case 'Blob':
    case 'File':
      return { type: 'string', contentMediaType: '*/*' }
  }

  return undefined
}

export function setSchema(items: JsonSchema): ObjectJsonSchema {
  return {
    'type': 'array',
    'uniqueItems': true,
    items,
    'x-native-type': JsonSchemaXNativeType.Set,
  }
}

export function mapSchema(entries: JsonSchema): ObjectJsonSchema {
  return {
    'type': 'array',
    'items': entries,
    'x-native-type': JsonSchemaXNativeType.Map,
  }
}

export function withNull(schema: JsonSchema): JsonSchema {
  if (typeof schema === 'object' && schema.anyOf && Object.keys(schema).length === 1) {
    return { anyOf: dedupe([...schema.anyOf, { type: 'null' }]) }
  }

  return { anyOf: [schema, { type: 'null' }] }
}

export function dedupe(schemas: JsonSchema[]): JsonSchema[] {
  const seen = new Set<string | undefined>()

  return schemas.filter((schema) => {
    const key = stringifyJSON(schema)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

export function isPlain(schema: JsonSchema, type: string): boolean {
  return typeof schema === 'object' && schema.type === type && Object.keys(schema).length === 1
}

const ANNOTATION_KEYWORDS = ['description', 'deprecated', 'examples', 'default']

const TRIVIAL_KEYWORDS = new Set([
  'type',
  'format',
  'pattern',
  'x-native-type',
  ...ANNOTATION_KEYWORDS,
])

const LITERAL_KEYWORDS = new Set(['type', 'const', 'enum', ...ANNOTATION_KEYWORDS])

/**
 * An empty schema, a primitive schema without enums or structure, or a union of them, such as `string | null`.
 */
export function isTrivialSchema(schema: JsonSchema): boolean {
  if (typeof schema !== 'object' || Object.keys(schema).length === 0) {
    return true
  }

  if (schema.anyOf && Object.keys(schema).length === 1) {
    return schema.anyOf.every(isTrivialSchema)
  }

  return (
    typeof schema.type === 'string' &&
    schema.type !== 'object' &&
    schema.type !== 'array' &&
    Object.keys(schema).every((key) => TRIVIAL_KEYWORDS.has(key))
  )
}

/**
 * A single literal or a literal enum, such as `42` or `'a' | 'b'`.
 */
export function isLiteralSchema(schema: JsonSchema): boolean {
  return (
    typeof schema === 'object' &&
    (schema.const !== undefined || schema.enum !== undefined) &&
    Object.keys(schema).every((key) => LITERAL_KEYWORDS.has(key))
  )
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&')
}

/**
 * JSON Schema keywords that can be set through JSDoc tags of the same name, e.g. `@minimum 0`,
 * by the type of their value.
 */
const JSDOC_STRING_KEYWORDS = new Set([
  'title',
  'format',
  'pattern',
  'contentMediaType',
  'contentEncoding',
])

const JSDOC_NUMBER_KEYWORDS = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minProperties',
  'maxProperties',
])

const JSDOC_BOOLEAN_KEYWORDS = new Set(['uniqueItems', 'readOnly', 'writeOnly'])

const JSDOC_KEYWORD_TAGS: ReadonlySet<string> = new Set([
  ...JSDOC_STRING_KEYWORDS,
  ...JSDOC_NUMBER_KEYWORDS,
  ...JSDOC_BOOLEAN_KEYWORDS,
  'default',
])

/**
 * The keyword value of a JSDoc tag, or `undefined` when the text is not a valid value for it:
 * strings are taken as written (`@pattern [0-9]+`), numbers must be finite,
 * booleans default to `true` (`@readOnly`), and `@default` is JSON when it parses.
 */
function getKeywordValue(keyword: string, text: string): unknown {
  if (JSDOC_STRING_KEYWORDS.has(keyword)) {
    return text === '' ? undefined : text
  }

  if (JSDOC_NUMBER_KEYWORDS.has(keyword)) {
    const value = parseTagValue(text)
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  }

  if (JSDOC_BOOLEAN_KEYWORDS.has(keyword)) {
    const value = text === '' ? true : parseTagValue(text)
    return typeof value === 'boolean' ? value : undefined
  }

  return text === '' ? undefined : parseTagValue(text)
}

const JSON_SCHEMA_TYPES = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
  'null',
])

/**
 * Applies JSDoc to a schema: the comment becomes `description`, `@deprecated` sets `deprecated`,
 * `@example` adds to `examples`, `@type integer` sets the type,
 * and tags named like JSON Schema keywords (`@minimum 1`, `@format email`) set that keyword.
 */
export function applyJSDoc(
  schema: JsonSchema,
  comment: string,
  tags: readonly JSDocTagInfo[],
): JsonSchema {
  if (typeof schema !== 'object') {
    return schema
  }

  let annotated: ObjectJsonSchema = { ...schema }

  if (comment) {
    annotated.description = comment
  }

  for (const tag of tags) {
    const text = tag.text?.trim() ?? ''

    if (tag.name === 'deprecated') {
      annotated.deprecated = true
    } else if (tag.name === 'example' || tag.name === 'examples') {
      if (text) {
        annotated.examples = dedupe([
          ...((annotated.examples as JsonSchema[]) ?? []),
          parseTagValue(text) as any,
        ])
      }
    } else if (tag.name === 'type' && JSON_SCHEMA_TYPES.has(text)) {
      annotated = overrideType(annotated, text)
    } else if (JSDOC_KEYWORD_TAGS.has(tag.name)) {
      const value = getKeywordValue(tag.name, text)
      if (value !== undefined) {
        ;(annotated as Record<string, unknown>)[tag.name] = value
      }
    }
  }

  return annotated
}

/**
 * Sets the `type` of a schema from `@type`, keeping `null` branches (`number | null`)
 * and leaving refs untouched.
 */
function overrideType(schema: ObjectJsonSchema, type: string): ObjectJsonSchema {
  if (schema.$ref !== undefined) {
    return schema
  }

  if (schema.anyOf && schema.type === undefined) {
    return {
      ...schema,
      anyOf: schema.anyOf.map((member) =>
        typeof member === 'object' && member.type !== 'null' ? overrideType(member, type) : member,
      ),
    }
  }

  return { ...schema, type: type as any }
}

function parseTagValue(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
