// eslint-disable-next-line no-restricted-imports
import type { JSONSchema, keywords } from 'json-schema-typed/draft-2020-12'
// eslint-disable-next-line no-restricted-imports
import { ContentEncoding as JSONSchemaContentEncoding, Format as JSONSchemaFormat, TypeName as JSONSchemaTypeName } from 'json-schema-typed/draft-2020-12'

export { JSONSchemaContentEncoding, JSONSchemaFormat, JSONSchemaTypeName }
export type { JSONSchema }

/**
 * @internal
 */
export type ObjectSchema = JSONSchema & { type: 'object' } & object

/**
 * @internal
 */
export type FileSchema = JSONSchema & { type: 'string', contentMediaType: string } & object

/**
 * @internal
 */
export const LOGIC_KEYWORDS: string[] = [
  '$dynamicRef',
  '$ref',
  'additionalItems',
  'additionalProperties',
  'allOf',
  'anyOf',
  'const',
  'contains',
  'contentEncoding',
  'contentMediaType',
  'contentSchema',
  'dependencies',
  'dependentRequired',
  'dependentSchemas',
  'else',
  'enum',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'format',
  'if',
  'items',
  'maxContains',
  'maximum',
  'maxItems',
  'maxLength',
  'maxProperties',
  'minContains',
  'minimum',
  'minItems',
  'minLength',
  'minProperties',
  'multipleOf',
  'not',
  'oneOf',
  'pattern',
  'patternProperties',
  'prefixItems',
  'properties',
  'propertyNames',
  'required',
  'then',
  'type',
  'unevaluatedItems',
  'unevaluatedProperties',
  'uniqueItems',
] satisfies (typeof keywords)[number][]
