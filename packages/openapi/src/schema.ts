import * as JSONSchema from 'json-schema-typed/draft-2020-12'

export { Format as JSONSchemaFormat } from 'json-schema-typed/draft-2020-12'
export { JSONSchema }

export type ObjectSchema = JSONSchema.JSONSchema & { type: 'object' } & object
export type FileSchema = JSONSchema.JSONSchema & { type: 'string', contentMediaType: string } & object

export const NON_LOGIC_KEYWORDS = [
  // Core Documentation Keywords
  '$anchor',
  '$comment',
  '$defs',
  '$id',
  'title',
  'description',

  // Value Keywords
  'default',
  'deprecated',
  'examples',

  // Metadata Keywords
  '$schema',
  'definitions', // Legacy, but still used
  'readOnly',
  'writeOnly',

  // Display and UI Hints
  'contentMediaType',
  'contentEncoding',
  'format',

  // Custom Extensions
  '$vocabulary',
  '$dynamicAnchor',
  '$dynamicRef',
] satisfies (typeof JSONSchema.keywords)[number][]
