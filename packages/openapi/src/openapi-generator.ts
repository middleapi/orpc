import type { ContractRouter } from '@orpc/contract'
import type { ANY_ROUTER } from '@orpc/server'
import type { PublicOpenAPIPathParser } from './openapi-path-parser'
import type { SchemaConverter } from './schema-converter'
import { JSONSerializer, type PublicJSONSerializer } from './json-serializer'
import { type OpenAPI, OpenApiBuilder } from './openapi'
import { OpenAPIContentBuilder, type PublicOpenAPIContentBuilder } from './openapi-content-builder'
import { OpenAPIParametersBuilder, type PublicOpenAPIParametersBuilder } from './openapi-parameters-builder'
import { OpenAPIPathParser } from './openapi-path-parser'
import { CompositeSchemaConverter } from './schema-converter'
import { type PublicSchemaUtils, SchemaUtils } from './schema-utils'
import { forEachAllContractProcedure, standardizeHTTPPath } from './utils'

export interface OpenAPIGeneratorOptions {
  contentBuilder?: PublicOpenAPIContentBuilder
  parametersBuilder?: PublicOpenAPIParametersBuilder
  schemaConverters?: SchemaConverter[]
  schemaUtils?: PublicSchemaUtils
  jsonSerializer?: PublicJSONSerializer
  pathParser?: PublicOpenAPIPathParser

  /**
   * Throw error when you missing define tag definition on OpenAPI root tags
   *
   * Example: if procedure has tags ['foo', 'bar'], and OpenAPI root tags is ['foo'], then error will be thrown
   * Because OpenAPI root tags is missing 'bar' tag
   *
   * @default false
   */
  considerMissingTagDefinitionAsError?: boolean

  /**
   * Weather ignore procedures that has no path defined.
   *
   * @default false
   */
  ignoreUndefinedPathProcedures?: boolean

  /**
   * Throw error when you have error in OpenAPI generator
   *
   * @default false
   */
  throwOnError?: boolean
}

export class OpenAPIGenerator {
  private readonly contentBuilder: PublicOpenAPIContentBuilder
  private readonly parametersBuilder: PublicOpenAPIParametersBuilder
  private readonly schemaConverter: CompositeSchemaConverter
  private readonly schemaUtils: PublicSchemaUtils
  private readonly jsonSerializer: PublicJSONSerializer
  private readonly pathParser: PublicOpenAPIPathParser

  constructor(private readonly options?: OpenAPIGeneratorOptions) {
    this.parametersBuilder = options?.parametersBuilder ?? new OpenAPIParametersBuilder()
    this.schemaConverter = new CompositeSchemaConverter(options?.schemaConverters ?? [])
    this.schemaUtils = options?.schemaUtils ?? new SchemaUtils()
    this.jsonSerializer = options?.jsonSerializer ?? new JSONSerializer()
    this.contentBuilder = options?.contentBuilder ?? new OpenAPIContentBuilder(this.schemaUtils)
    this.pathParser = new OpenAPIPathParser()
  }

  async generate(router: ContractRouter | ANY_ROUTER, doc: Omit<OpenAPI.OpenAPIObject, 'openapi'>): Promise<OpenAPI.OpenAPIObject> {
    const builder = new OpenApiBuilder({
      ...doc,
      openapi: '3.1.1',
    })

    const rootTags = doc.tags?.map(tag => tag.name) ?? []

    await forEachAllContractProcedure(router, ({ contract, path }) => {
      const def = contract['~orpc']

      if (this.options?.ignoreUndefinedPathProcedures && def.route?.path === undefined) {
        return
      }

      const method = def.route?.method ?? 'POST'
      const httpPath = def.route?.path ? standardizeHTTPPath(def.route?.path) : `/${path.map(encodeURIComponent).join('/')}`

      let inputSchema = this.schemaConverter.convert(def.InputSchema, { strategy: 'input' })
      const outputSchema = this.schemaConverter.convert(def.OutputSchema, { strategy: 'output' })

      const params: OpenAPI.ParameterObject[] | undefined = (() => {
        const dynamic = this.pathParser.parseDynamicParams(httpPath)

        if (!dynamic.length) {
          return undefined
        }

        if (this.schemaUtils.isAnySchema(inputSchema)) {
          return undefined
        }

        if (!this.schemaUtils.isObjectSchema(inputSchema)) {
          this.handleError(
            new Error(
              `When path has parameters, input schema must be an object [${path.join('.')}]`,
            ),
          )

          return undefined
        }

        const [matched, rest] = this.schemaUtils.separateObjectSchema(inputSchema, dynamic.map(v => v.name))

        inputSchema = rest

        return this.parametersBuilder.build('path', matched, {
          example: def.inputExample,
          required: true,
        })
      })()

      const query: OpenAPI.ParameterObject[] | undefined = (() => {
        if (method !== 'GET' || Object.keys(inputSchema).length === 0) {
          return undefined
        }

        if (this.schemaUtils.isAnySchema(inputSchema)) {
          return undefined
        }

        if (!this.schemaUtils.isObjectSchema(inputSchema)) {
          this.handleError(
            new Error(
              `When method is GET, input schema must be an object [${path.join('.')}]`,
            ),
          )

          return undefined
        }

        return this.parametersBuilder.build('query', inputSchema, {
          example: def.inputExample,
        })
      })()

      const parameters = [...(params ?? []), ...(query ?? [])]

      const requestBody: OpenAPI.RequestBodyObject | undefined = (() => {
        if (method === 'GET') {
          return undefined
        }

        return {
          required: this.schemaUtils.isUndefinableSchema(inputSchema),
          content: this.contentBuilder.build(inputSchema, {
            example: def.inputExample,
          }),
        }
      })()

      const successResponse: OpenAPI.ResponseObject = {
        description: 'OK',
        content: this.contentBuilder.build(outputSchema, {
          example: def.outputExample,
        }),
      }

      if (this.options?.considerMissingTagDefinitionAsError && def.route?.tags) {
        const missingTag = def.route?.tags.find(tag => !rootTags.includes(tag))

        if (missingTag !== undefined) {
          this.handleError(
            new Error(
              `Tag "${missingTag}" is missing definition. Please define it in OpenAPI root tags object. [${path.join('.')}]`,
            ),
          )
        }
      }

      const operation: OpenAPI.OperationObject = {
        summary: def.route?.summary,
        description: def.route?.description,
        deprecated: def.route?.deprecated,
        tags: def.route?.tags ? [...def.route.tags] : undefined,
        operationId: path.join('.'),
        parameters: parameters.length ? parameters : undefined,
        requestBody,
        responses: {
          200: successResponse,
        },
      }

      builder.addPath(httpPath, {
        [method.toLocaleLowerCase()]: operation,
      })
    })

    return this.jsonSerializer.serialize(builder.getSpec()) as OpenAPI.OpenAPIObject
  }

  private handleError(error: Error): void {
    if (this.options?.throwOnError) {
      throw error
    }

    console.error(error)
  }
}
