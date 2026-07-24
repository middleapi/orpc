import type { AnyProcedureContract, AnySchema, RouterContract } from '@orpc/contract'
import type { JsonSchema, JsonSchemaConverter, JsonSchemaConverterDirection } from '@orpc/json-schema'
import type { AnyProcedure, AnyRouter } from '@orpc/server'
import type { Value } from '@orpc/shared'
import type { OpenAPIMeta } from './meta'
import type { OpenAPIErrorBodyDefinition, OpenAPIOperationContext } from './openapi-generator-operation'
import type { OpenAPIDocument, OpenAPIOperationObject } from './types'
import { COMMON_ERROR_STATUS_MAP } from '@orpc/client'
import { combineJsonSchemasWithComposition, DelegatingJsonSchemaConverter, StandardJsonSchemaConverter } from '@orpc/json-schema'
import { walkProcedureContractsAsync } from '@orpc/server'
import { clone, mergeHttpPath, pathToHttpPath, toArray, value } from '@orpc/shared'
import { DEFAULT_OPENAPI_METHOD } from './constants'
import { getOpenAPIMeta } from './meta'
import { OpenAPIComponentRegistry } from './openapi-generator-components'
import {
  buildErrorResponse,
  buildRequest,
  buildSuccessResponse,
  OpenAPIGeneratorError,
  toOpenAPIPath,
} from './openapi-generator-operation'
import { OpenAPISerializer } from './openapi-serializer'
import { getDynamicPathParams } from './utils'

export { OpenAPIGeneratorError } from './openapi-generator-operation'
export type { OpenAPIErrorBodyDefinition } from './openapi-generator-operation'

export interface OpenAPIGeneratorOptions {
  converters?: JsonSchemaConverter[] | undefined

  /**
   * The serializer used to serialize the generated OpenAPI documentation
   */
  serializer?: Pick<OpenAPISerializer, keyof OpenAPISerializer> | undefined
}

export interface OpenAPIGeneratorGenerateOptions {
  base?: Partial<OpenAPIDocument> | undefined

  /**
   * Controls whether a generated json schema `$defs` at root-level should be moved into `components.schemas`.
   *
   * @default true
   */
  shouldHoistDef?: Value<boolean, [defName: string, defSchema: JsonSchema]>

  /**
   * Filter procedures. Return `false` to exclude a procedure from the OpenAPI specification.
   *
   * @default true
   */
  filter?: Value<boolean, [contract: AnyProcedureContract | AnyProcedure, path: string[]]>

  /**
   * Define a custom JSON schema for the error response body when using
   * type-safe errors. Helps align ORPC error formatting with existing API
   * response standards or conventions.
   *
   * @remarks
   * - Return `null | undefined` to use the default error response body shaper.
   */
  customErrorResponseBodySchema?: Value<
    JsonSchema | undefined | null,
    [definedErrors: OpenAPIErrorBodyDefinition[], status: number]
  >

  /**
   * Mapping ORPCError Code -> HTTP Status Code
   *
   * @default COMMON_ERROR_STATUS_MAP
   */
  errorStatusMap?: Record<string, number> | undefined
}

export class OpenAPIGenerator {
  private readonly serializer: Pick<OpenAPISerializer, keyof OpenAPISerializer>
  private readonly converter: Pick<JsonSchemaConverter, 'convert'>

  constructor(options: OpenAPIGeneratorOptions = {}) {
    this.serializer = options.serializer ?? new OpenAPISerializer()
    this.converter = new DelegatingJsonSchemaConverter([
      ...toArray(options.converters),
      new StandardJsonSchemaConverter(),
    ])
  }

  async generate(router: RouterContract | AnyRouter, options: OpenAPIGeneratorGenerateOptions = {}): Promise<OpenAPIDocument> {
    const doc: OpenAPIDocument = {
      ...clone(options.base),
      openapi: options.base?.openapi ?? '3.1.2',
      info: options.base?.info ?? { title: 'API Reference', version: '0.0.0' },
    }

    const ctx: OpenAPIOperationContext = {
      registry: new OpenAPIComponentRegistry(doc, options.shouldHoistDef),
      convertSchemas: (schemas, direction) => this.convertSchemas(schemas, direction),
      errorStatusMap: options.errorStatusMap ?? COMMON_ERROR_STATUS_MAP,
      customErrorResponseBodySchema: options.customErrorResponseBodySchema,
    }

    const errors: string[] = []

    await walkProcedureContractsAsync(router, (contract, path) => {
      if (value(options.filter, contract, path) === false) {
        return
      }

      try {
        const def = contract['~orpc']
        const meta = getOpenAPIMeta(contract)

        const method = (meta?.method ?? DEFAULT_OPENAPI_METHOD).toLowerCase() as Lowercase<NonNullable<OpenAPIMeta['method']>>
        const postPath = meta?.path ?? pathToHttpPath(path)
        const httpPath = meta?.prefix ? mergeHttpPath(meta.prefix, postPath) : postPath
        const dynamicPathParams = getDynamicPathParams(httpPath)
        const openApiPath = toOpenAPIPath(httpPath, dynamicPathParams)

        let operation: OpenAPIOperationObject

        if (meta?.spec !== undefined && typeof meta.spec !== 'function') {
          operation = meta.spec
        }
        else {
          operation = {
            operationId: meta?.operationId ?? path.join('.'),
            summary: meta?.summary,
            description: meta?.description,
            deprecated: meta?.deprecated,
            tags: meta?.tags?.map(tag => tag),
          }

          buildRequest(ctx, operation, def, meta, dynamicPathParams)
          buildSuccessResponse(ctx, operation, def, meta)
          buildErrorResponse(ctx, operation, def)
        }

        if (typeof meta?.spec === 'function') {
          operation = meta.spec(operation)
        }

        doc.paths ??= {}
        doc.paths[openApiPath] ??= {}
        doc.paths[openApiPath][method] = operation
      }
      catch (e) {
        if (!(e instanceof OpenAPIGeneratorError)) {
          throw e
        }
        errors.push(`Procedure at ${path.join('.') || '(root)'}: ${e.message}`)
      }
    })

    if (errors.length) {
      throw new OpenAPIGeneratorError(
        `[OpenAPIGenerator] Failed to generate the OpenAPI document (${errors.length} error${errors.length === 1 ? '' : 's'}):\n\n${errors.join('\n\n')}`,
      )
    }

    return this.serializer.serialize(doc, { asFormData: false, useFormDataForBlobFields: false }) as OpenAPIDocument
  }

  private convertSchema(schema: AnySchema | undefined, direction: JsonSchemaConverterDirection): [JsonSchema, boolean] {
    const [jsonSchema, optional] = this.converter.convert(schema as any, direction)
    return [strip$schemaField(jsonSchema), optional]
  }

  private convertSchemas(schemas: AnySchema[] | undefined, direction: JsonSchemaConverterDirection): [JsonSchema, boolean] {
    if (!schemas || schemas.length <= 1) {
      return this.convertSchema(schemas?.[0], direction)
    }

    const results = schemas.map(s => this.convertSchema(s, direction))

    return [
      combineJsonSchemasWithComposition('allOf', results.map(([jsonSchema]) => jsonSchema)),
      results.every(([, optional]) => optional),
    ]
  }
}

function strip$schemaField(schema: JsonSchema): JsonSchema {
  if (typeof schema !== 'object') {
    return schema
  }
  const { $schema, ...rest } = schema
  return rest
}
