// eslint-disable-next-line no-restricted-imports
import type * as Draft2020 from 'json-schema-typed/draft-2020-12'

export type JsonSchema = Draft2020.JSONSchema
export type JsonSchemaKeywords = typeof Draft2020.keywords[number]

export enum JsonSchemaXNativeType {
  BigInt = 'bigint',
  RegExp = 'regexp',
  Date = 'date',
  Url = 'url',
  Set = 'set',
  Map = 'map',
}

// eslint-disable-next-line no-restricted-imports
export { Format as JsonSchemaFormat, TypeName as JsonSchemaType } from 'json-schema-typed/draft-2020-12'
