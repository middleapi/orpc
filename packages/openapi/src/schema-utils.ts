import { isPlainObject } from '@orpc/shared'
import { type FileSchema, type JSONSchema, NON_LOGIC_KEYWORDS, type ObjectSchema } from './schema'

export class SchemaUtils {
  isFileSchema(schema: JSONSchema.JSONSchema): schema is FileSchema {
    return typeof schema === 'object' && schema.type === 'string' && typeof schema.contentMediaType === 'string'
  }

  isObjectSchema(schema: JSONSchema.JSONSchema): schema is ObjectSchema {
    return typeof schema === 'object' && schema.type === 'object'
  }

  isAnySchema(schema: JSONSchema.JSONSchema): boolean {
    return schema === true || Object.keys(schema).length === 0
  }

  isUndefinableSchema(schema: JSONSchema.JSONSchema): boolean {
    const [matches] = this.filterSchemaBranches(schema, (schema) => {
      if (typeof schema === 'boolean') {
        return schema
      }

      return Object.keys(schema).length === 0
    })

    return matches.length > 0
  }

  separateObjectSchema(schema: ObjectSchema, separatedProperties: string[]): [matched: ObjectSchema, rest: ObjectSchema] {
    const matched = { ...schema }
    const rest = { ...schema }

    matched.properties = Object.entries(schema.properties ?? {})
      .filter(([key]) => separatedProperties.includes(key))
      .reduce((acc, [key, value]) => {
        acc[key] = value
        return acc
      }, {} as Record<string, JSONSchema.JSONSchema>)

    matched.required = schema.required?.filter(key => separatedProperties.includes(key))

    matched.examples = schema.examples?.map((example) => {
      if (!isPlainObject(example)) {
        return example
      }

      return Object.entries(example).reduce((acc, [key, value]) => {
        if (separatedProperties.includes(key)) {
          acc[key] = value
        }

        return acc
      }, {} as Record<string, unknown>)
    })

    rest.properties = Object.entries(schema.properties ?? {})
      .filter(([key]) => !separatedProperties.includes(key))
      .reduce((acc, [key, value]) => {
        acc[key] = value
        return acc
      }, {} as Record<string, JSONSchema.JSONSchema>)

    rest.required = schema.required?.filter(key => !separatedProperties.includes(key))

    rest.examples = schema.examples?.map((example) => {
      if (!isPlainObject(example)) {
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

  filterSchemaBranches(
    schema: JSONSchema.JSONSchema,
    check: (schema: JSONSchema.JSONSchema) => boolean,
    matches: JSONSchema.JSONSchema[] = [],
  ): [matches: JSONSchema.JSONSchema[], rest: JSONSchema.JSONSchema | undefined] {
    if (check(schema)) {
      matches.push(schema)
      return [matches, undefined]
    }

    if (typeof schema === 'boolean') {
      return [matches, schema]
    }

    // TODO: $ref

    if (
      schema.anyOf
      && Object.keys(schema).every(
        k => k === 'anyOf' || NON_LOGIC_KEYWORDS.includes(k as any),
      )
    ) {
      const anyOf = schema.anyOf
        .map(s => this.filterSchemaBranches(s, check, matches)[1])
        .filter(v => !!v)

      if (anyOf.length === 1 && typeof anyOf[0] === 'object') {
        return [matches, { ...schema, anyOf: undefined, ...anyOf[0] }]
      }

      return [matches, { ...schema, anyOf }]
    }

    // TODO: $ref

    if (
      schema.oneOf
      && Object.keys(schema).every(
        k => k === 'oneOf' || NON_LOGIC_KEYWORDS.includes(k as any),
      )
    ) {
      const oneOf = schema.oneOf
        .map(s => this.filterSchemaBranches(s, check, matches)[1])
        .filter(v => !!v)

      if (oneOf.length === 1 && typeof oneOf[0] === 'object') {
        return [matches, { ...schema, oneOf: undefined, ...oneOf[0] }]
      }

      return [matches, { ...schema, oneOf }]
    }

    return [matches, schema]
  }
}

export type PublicSchemaUtils = Pick<SchemaUtils, keyof SchemaUtils>
