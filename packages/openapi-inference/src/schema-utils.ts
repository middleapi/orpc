import type { JsonSchema } from '@orpc/json-schema'
import {
  decodeJsonPointerSegment,
  encodeJsonPointerSegment,
  getJsonSchemaKeywordKind,
  JsonSchemaFormat,
  JsonSchemaXNativeType,
  visitJsonSchemaRefs,
} from '@orpc/json-schema'
import { setOwn, stringifyJSON } from '@orpc/shared'
import type { JSDocTagInfo } from 'typescript/unstable/sync'

export type ObjectJsonSchema = Exclude<JsonSchema, boolean>

const DEFS_REF_PREFIX = '#/$defs/'

export function toRef(name: string): string {
  return `${DEFS_REF_PREFIX}${encodeJsonPointerSegment(name)}`
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

  return decodeJsonPointerSegment(schema.$ref.slice(DEFS_REF_PREFIX.length))
}

/**
 * The names of the local defs a schema refers to directly.
 */
export function collectDefRefs(schema: JsonSchema): Set<string> {
  const names = new Set<string>()

  visitJsonSchemaRefs(schema, (ref) => {
    if (ref.startsWith(DEFS_REF_PREFIX)) {
      names.add(decodeJsonPointerSegment(ref.slice(DEFS_REF_PREFIX.length).split('/')[0]!))
    }
  })

  return names
}

/**
 * Writes each union of refs to object defs that all require a property of distinct string literals
 * (`Circle | Square` by `kind`) as `oneOf` with an OpenAPI `discriminator`, like Zod and Valibot
 * write discriminated unions as `oneOf`. Being decided on the schemas, it holds for the values
 * as serialized, and does not depend on how the union was reached.
 */
export function withDiscriminators(
  schema: JsonSchema,
  getDef: (name: string) => JsonSchema | undefined,
): JsonSchema {
  const map = (value: unknown, schemaLevel: boolean): any => {
    if (Array.isArray(value)) {
      return value.map((item) => map(item, schemaLevel))
    }

    if (typeof value !== 'object' || value === null) {
      return value
    }

    const result: Record<string, unknown> = {}

    for (const key of Object.keys(value)) {
      const child = (value as Record<string, unknown>)[key]
      const kind = getJsonSchemaKeywordKind(key, child, schemaLevel)
      setOwn(
        result,
        key,
        kind === 'schema' ? map(child, true) : kind === 'schema-record' ? map(child, false) : child,
      )
    }

    const { anyOf, ...rest } = result as ObjectJsonSchema
    const discriminator =
      schemaLevel && anyOf && rest.oneOf === undefined && rest.discriminator === undefined
        ? getDiscriminator(anyOf, getDef)
        : undefined

    return discriminator ? { ...rest, oneOf: anyOf, discriminator } : result
  }

  return map(schema, true)
}

/**
 * The first property of the first member that each member requires as distinct string literals.
 */
function getDiscriminator(
  members: readonly JsonSchema[],
  getDef: (name: string) => JsonSchema | undefined,
): { propertyName: string; mapping: Record<string, string> } | undefined {
  const defs: ObjectJsonSchema[] = []

  for (const member of members) {
    const name = fromRef(member)
    const def = name === undefined ? undefined : getDef(name)

    if (typeof def !== 'object' || def.type !== 'object' || !def.properties) {
      return undefined
    }
    defs.push(def)
  }

  if (defs.length < 2) {
    return undefined
  }

  for (const propertyName of Object.keys(defs[0]!.properties!)) {
    const mapping: Record<string, string> = {}

    const discriminates = defs.every((def, i) => {
      const values = def.required?.includes(propertyName)
        ? getStringLiterals(def.properties![propertyName]!, getDef)
        : undefined

      return values?.every((value) => {
        if (Object.hasOwn(mapping, value)) {
          return false
        }
        setOwn(mapping, value, (members[i] as ObjectJsonSchema).$ref!)
        return true
      })
    })

    if (discriminates) {
      return { propertyName, mapping }
    }
  }

  return undefined
}

/**
 * The values of a schema of string literals (`'a'` or `'a' | 'b'`), also through refs to defs.
 */
function getStringLiterals(
  schema: JsonSchema,
  getDef: (name: string) => JsonSchema | undefined,
): string[] | undefined {
  let resolved: JsonSchema | undefined = schema
  const seen = new Set<string>()

  for (let name = fromRef(schema); name !== undefined; name = fromRef(resolved)) {
    resolved = seen.has(name) ? undefined : getDef(name)
    if (resolved === undefined) {
      return undefined
    }
    seen.add(name)
  }

  if (!isLiteralSchema(resolved) || (resolved as ObjectJsonSchema).type !== 'string') {
    return undefined
  }

  const { const: value, enum: values } = resolved as ObjectJsonSchema
  const literals: unknown[] = values ?? [value]

  return literals.length && literals.every((v) => typeof v === 'string')
    ? (literals as string[])
    : undefined
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

/**
 * The schema of a `Set`, of unique items when they are `primitives` written as distinct JSON:
 * distinct objects may be written the same, like two instances of a class by their `toJSON`.
 */
export function setSchema(items: JsonSchema, primitives: boolean): ObjectJsonSchema {
  return {
    'type': 'array',
    ...(primitives && writesDistinct(items) ? { uniqueItems: true } : {}),
    items,
    'x-native-type': JsonSchemaXNativeType.Set,
  }
}

/**
 * Whether distinct primitives of a schema are written as distinct JSON: strings, numbers, and
 * literals, not of different types, or dates, which distinct values may be written the same as.
 */
function writesDistinct(schema: JsonSchema): boolean {
  if (typeof schema !== 'object') {
    return false
  }

  // of different types, `'1'` and `1n` are both written as `"1"`
  if (schema.anyOf && Object.keys(schema).length === 1) {
    const types = schema.anyOf.map((s) => (typeof s === 'object' ? s.type : undefined))
    return schema.anyOf.every(writesDistinct) && new Set(types).size === types.length
  }

  if (schema.const !== undefined || schema.enum !== undefined) {
    return true
  }

  const native = schema['x-native-type']

  return (
    ['string', 'number', 'integer', 'boolean'].includes(schema.type as string) &&
    (native === undefined || native === JsonSchemaXNativeType.BigInt) &&
    schema.contentMediaType === undefined
  )
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

/**
 * Schemas without duplicates, keeping the first of equal ones, or a declared one over what
 * a value writes (see {@link writtenForm}).
 */
export function dedupe(schemas: JsonSchema[]): JsonSchema[] {
  const indexes = new Map<string | undefined, number>()
  const deduped: JsonSchema[] = []

  for (const schema of schemas) {
    const key = stringifyJSON(schema)
    const index = indexes.get(key)

    if (index === undefined) {
      indexes.set(key, deduped.length)
      deduped.push(schema)
    } else if (isWrittenForm(deduped[index]!) && !isWrittenForm(schema)) {
      deduped[index] = schema
    }
  }

  return deduped
}

/** Schemas of what a value writes in place of its fields, see {@link writtenForm} */
const WRITTEN_FORMS = new WeakSet()

/**
 * Marks a schema of what a value writes in place of its fields, like what `toJSON` returns or
 * the built-in a class extends, which an input split into parameters is not read by.
 */
export function writtenForm(schema: JsonSchema): JsonSchema {
  if (typeof schema !== 'object') {
    return schema
  }

  // also its members, which a union it is merged into holds
  const marked = schema.anyOf ? { ...schema, anyOf: schema.anyOf.map(writtenForm) } : { ...schema }
  WRITTEN_FORMS.add(marked)
  return marked
}

function isWrittenForm(schema: JsonSchema): boolean {
  return typeof schema === 'object' && WRITTEN_FORMS.has(schema)
}

/**
 * The members of a union a client sends the fields of, also of nested unions and of the defs
 * `resolve` returns for refs: an input split into parameters is read by its fields, never by
 * what an instance's `toJSON` returns or the built-in it extends. A declared empty object (of
 * `object` or `{}`) holds none of the fields, which keeps them optional. The same schema when
 * nothing changes.
 */
export function objectMembers(
  schema: JsonSchema,
  resolve: (ref: JsonSchema) => JsonSchema | undefined,
): JsonSchema {
  if (typeof schema !== 'object' || !schema.anyOf) {
    return schema
  }

  const sent = schema.anyOf.filter((m) => !isWrittenForm(m))

  // only written forms, which no client sends as fields
  if (!sent.length) {
    return schema
  }

  const members = sent.map((member) => {
    const resolved = resolve(member)
    const filtered = objectMembers(resolved ?? member, resolve)

    if (filtered === resolved) {
      return member
    }

    return typeof filtered === 'object' && Object.keys(filtered).length === 0
      ? { type: 'object' as const }
      : filtered
  })

  if (members.length === schema.anyOf.length && members.every((m, i) => m === schema.anyOf![i])) {
    return schema
  }

  const deduped = dedupe(members)
  const { anyOf: _, ...rest } = schema
  return deduped.length === 1
    ? { ...rest, ...(deduped[0] as ObjectJsonSchema) }
    : { ...rest, anyOf: deduped }
}

/**
 * An object schema, or a union of them, without required properties.
 */
export function withoutRequired(schema: JsonSchema): JsonSchema {
  if (typeof schema !== 'object') {
    return schema
  }

  const { required: _, ...rest } = schema
  return schema.anyOf ? { ...rest, anyOf: schema.anyOf.map(withoutRequired) } : rest
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
