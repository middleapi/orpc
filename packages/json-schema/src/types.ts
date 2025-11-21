// eslint-disable-next-line no-restricted-imports
import type * as Draft07 from 'json-schema-typed/draft-07'
// eslint-disable-next-line no-restricted-imports
import type * as Draft2019 from 'json-schema-typed/draft-2019-09'
// eslint-disable-next-line no-restricted-imports
import type * as Draft2020 from 'json-schema-typed/draft-2020-12'

export type JsonSchema
  = | Draft2020.JSONSchema
    | Draft2019.JSONSchema
    | Draft07.JSONSchema

export enum JsonSchemaXNativeType {
  BigInt = 'bigint',
  RegExp = 'regexp',
  Date = 'date',
  Url = 'url',
  Set = 'set',
  Map = 'map',
}
