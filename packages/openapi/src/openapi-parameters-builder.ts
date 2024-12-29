import type { OpenAPI } from './openapi'
import type { JSONSchema } from './schema'
import { get, isPlainObject } from '@orpc/shared'

export class OpenAPIParametersBuilder {
  build(
    paramIn: OpenAPI.ParameterObject['in'],
    jsonSchema: JSONSchema.JSONSchema & { type: 'object' } & object,
    options?: Pick<OpenAPI.ParameterObject, 'example' | 'style' | 'required'>,
  ): OpenAPI.ParameterObject[] {
    const parameters: OpenAPI.ParameterObject[] = []

    for (const name in jsonSchema.properties) {
      const schema = jsonSchema.properties[name]!

      const paramExamples = jsonSchema.examples
        ?.filter((example) => {
          return isPlainObject(example) && name in example
        })
        .map((example) => {
          return example[name]
        })

      const paramSchema = {
        examples: paramExamples?.length ? paramExamples : undefined,
        ...(schema === true
          ? {}
          : schema === false
            ? { not: {} }
            : schema),
      }

      const paramExample = get(options?.example, [name])

      parameters.push({
        name,
        in: paramIn,
        required: typeof options?.required === 'boolean' ? options.required : jsonSchema.required?.includes(name) ?? false,
        schema: paramSchema as any,
        example: paramExample,
        style: options?.style,
      })
    }

    return parameters
  }
}

export type PublicOpenAPIParametersBuilder = Pick<OpenAPIParametersBuilder, keyof OpenAPIParametersBuilder>
