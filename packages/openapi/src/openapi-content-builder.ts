import type { OpenAPI } from './openapi'
import type { JSONSchema } from './schema'
import type { PublicSchemaUtils } from './schema-utils'
import { findDeepMatches } from '@orpc/shared'

export class OpenAPIContentBuilder {
  constructor(
    private readonly schemaUtils: PublicSchemaUtils,
  ) {}

  build(jsonSchema: JSONSchema.JSONSchema, options?: Partial<OpenAPI.MediaTypeObject>): OpenAPI.ContentObject {
    const isFileSchema = this.schemaUtils.isFileSchema.bind(this.schemaUtils)

    const [matches, schema] = this.schemaUtils.filterSchemaBranches(jsonSchema, isFileSchema)

    const files = matches as (JSONSchema.JSONSchema & {
      type: 'string'
      contentMediaType: string
    })[]

    const content: OpenAPI.ContentObject = {}

    for (const file of files) {
      content[file.contentMediaType] = {
        schema: file as any,
      }
    }

    const isStillHasFileSchema = findDeepMatches(isFileSchema as any /** TODO */, schema).values.length > 0

    if (schema !== undefined) {
      content[
        isStillHasFileSchema ? 'multipart/form-data' : 'application/json'
      ] = {
        schema: schema as any,
        ...options,
      }
    }

    return content
  }
}

export type PublicOpenAPIContentBuilder = Pick<OpenAPIContentBuilder, keyof OpenAPIContentBuilder>
