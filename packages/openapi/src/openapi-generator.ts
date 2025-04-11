import type { AnyContractProcedure, AnyContractRouter, ErrorMap } from '@orpc/contract'
import type { StandardOpenAPIJsonSerializerOptions } from '@orpc/openapi-client/standard'
import type { AnyRouter } from '@orpc/server'
import type { OpenAPI } from './openapi'
import type { JSONSchema } from './schema'
import type { ConditionalSchemaConverter, SchemaConverter } from './schema-converter'
import { fallbackORPCErrorMessage, fallbackORPCErrorStatus } from '@orpc/client'
import { toHttpPath } from '@orpc/client/standard'
import { fallbackContractConfig, getEventIteratorSchemaDetails } from '@orpc/contract'
import { getDynamicParams, StandardOpenAPIJsonSerializer } from '@orpc/openapi-client/standard'
import { resolveContractProcedures } from '@orpc/server'
import { clone, toArray } from '@orpc/shared'
import { applyCustomOpenAPIOperation } from './openapi-custom'
import { checkParamsSchema, toOpenAPIContent, toOpenAPIEventIteratorContent, toOpenAPIMethod, toOpenAPIParameters, toOpenAPIPath, toOpenAPISchema } from './openapi-utils'
import { CompositeSchemaConverter } from './schema-converter'
import { applySchemaOptionality, isAnySchema, isObjectSchema, separateObjectSchema } from './schema-utils'

class OpenAPIGeneratorError extends Error {}

export interface OpenAPIGeneratorOptions extends StandardOpenAPIJsonSerializerOptions {
  schemaConverters?: ConditionalSchemaConverter[]
}

export class OpenAPIGenerator {
  private readonly serializer: StandardOpenAPIJsonSerializer
  private readonly converter: SchemaConverter

  constructor(options: OpenAPIGeneratorOptions = {}) {
    this.serializer = new StandardOpenAPIJsonSerializer(options)
    this.converter = new CompositeSchemaConverter(toArray(options.schemaConverters))
  }

  async generate(router: AnyContractRouter | AnyRouter, base: Omit<OpenAPI.Document, 'openapi'>): Promise<OpenAPI.Document> {
    const doc: OpenAPI.Document = clone(base) as OpenAPI.Document
    doc.openapi = '3.1.1'

    const errors: string[] = []

    await resolveContractProcedures({ path: [], router }, ({ contract, path }) => {
      const operationId = path.join('.')

      try {
        const def = contract['~orpc']

        const method = toOpenAPIMethod(fallbackContractConfig('defaultMethod', def.route.method))
        const httpPath = toOpenAPIPath(def.route.path ?? toHttpPath(path))

        const operationObjectRef: OpenAPI.OperationObject = {
          operationId,
          summary: def.route.summary,
          description: def.route.description,
          deprecated: def.route.deprecated,
          tags: def.route.tags?.map(tag => tag),
        }

        this.#request(operationObjectRef, def)
        this.#successResponse(operationObjectRef, def)
        this.#errorResponse(operationObjectRef, def)

        doc.paths ??= {}
        doc.paths[httpPath] ??= {}
        doc.paths[httpPath][method] = applyCustomOpenAPIOperation(operationObjectRef, contract) as any
      }
      catch (e) {
        if (!(e instanceof OpenAPIGeneratorError)) {
          throw e
        }

        errors.push(
          `[OpenAPIGenerator] Error occurred while generating OpenAPI for procedure at path: ${operationId}\n${e.message}`,
        )
      }
    })

    if (errors.length) {
      throw new OpenAPIGeneratorError(
        `Some error occurred during OpenAPI generation:\n\n${errors.join('\n\n')}`,
      )
    }

    return this.serializer.serialize(doc)[0] as OpenAPI.Document
  }

  #request(ref: OpenAPI.OperationObject, def: AnyContractProcedure['~orpc']): void {
    const method = fallbackContractConfig('defaultMethod', def.route.method)
    const details = getEventIteratorSchemaDetails(def.inputSchema)

    if (details) {
      ref.requestBody = {
        required: true,
        content: toOpenAPIEventIteratorContent(
          this.converter.convert(details.yields, { strategy: 'input' }),
          this.converter.convert(details.returns, { strategy: 'input' }),
        ),
      }

      return
    }

    const dynamicParams = getDynamicParams(def.route.path)?.map(v => v.name)
    const inputStructure = fallbackContractConfig('defaultInputStructure', def.route.inputStructure)
    let [required, schema] = this.converter.convert(def.inputSchema, { strategy: 'input' })

    if (isAnySchema(schema) && !dynamicParams?.length) {
      return
    }

    if (inputStructure === 'compact') {
      if (dynamicParams?.length) {
        const error = new OpenAPIGeneratorError(
          'When input structure is "compact", and path has dynamic params, input schema must be an object with all dynamic params as required.',
        )

        if (!isObjectSchema(schema)) {
          throw error
        }

        const [paramsSchema, rest] = separateObjectSchema(schema, dynamicParams)

        schema = rest
        required = rest.required ? rest.required.length !== 0 : false

        if (!checkParamsSchema(paramsSchema, dynamicParams)) {
          throw error
        }

        ref.parameters ??= []
        ref.parameters.push(...toOpenAPIParameters(paramsSchema, 'path'))
      }

      if (method === 'GET') {
        if (!isObjectSchema(schema)) {
          throw new OpenAPIGeneratorError(
            'When method is "GET", input schema must satisfy: object | any | unknown',
          )
        }

        ref.parameters ??= []
        ref.parameters.push(...toOpenAPIParameters(schema, 'query'))
      }
      else {
        ref.requestBody = {
          required,
          content: toOpenAPIContent(schema),
        }
      }

      return
    }

    const error = new OpenAPIGeneratorError(
      'When input structure is "detailed", input schema must satisfy: '
      + '{ params?: Record<string, unknown>, query?: Record<string, unknown>, headers?: Record<string, unknown>, body?: unknown }',
    )

    if (!isObjectSchema(schema)) {
      throw error
    }

    if (
      dynamicParams?.length && (
        schema.properties?.params === undefined
        || !isObjectSchema(schema.properties.params)
        || !checkParamsSchema(schema.properties.params, dynamicParams)
      )
    ) {
      throw new OpenAPIGeneratorError(
        'When input structure is "detailed" and path has dynamic params, the "params" schema must be an object with all dynamic params as required.',
      )
    }

    for (const from of ['params', 'query', 'headers']) {
      const fromSchema = schema.properties?.[from]
      if (fromSchema !== undefined) {
        if (!isObjectSchema(fromSchema)) {
          throw error
        }

        const parameterIn: 'path' | 'query' | 'header' = from === 'params'
          ? 'path'
          : from === 'headers'
            ? 'header'
            : 'query'

        ref.parameters ??= []
        ref.parameters.push(...toOpenAPIParameters(fromSchema, parameterIn))
      }
    }

    if (schema.properties?.body !== undefined) {
      ref.requestBody = {
        required: schema.required?.includes('body'),
        content: toOpenAPIContent(schema.properties.body),
      }
    }
  }

  #successResponse(ref: OpenAPI.OperationObject, def: AnyContractProcedure['~orpc']): void {
    const outputSchema = def.outputSchema
    const status = fallbackContractConfig('defaultSuccessStatus', def.route.successStatus)
    const description = fallbackContractConfig('defaultSuccessDescription', def.route?.successDescription)
    const eventIteratorSchemaDetails = getEventIteratorSchemaDetails(outputSchema)
    const outputStructure = fallbackContractConfig('defaultOutputStructure', def.route.outputStructure)

    if (eventIteratorSchemaDetails) {
      ref.responses ??= {}
      ref.responses[status] = {
        description,
        content: toOpenAPIEventIteratorContent(
          this.converter.convert(eventIteratorSchemaDetails.yields, { strategy: 'output' }),
          this.converter.convert(eventIteratorSchemaDetails.returns, { strategy: 'output' }),
        ),
      }

      return
    }

    const [required, json] = this.converter.convert(outputSchema, { strategy: 'output' })

    ref.responses ??= {}
    ref.responses[status] = {
      description,
    }

    if (outputStructure === 'compact') {
      ref.responses[status].content = toOpenAPIContent(applySchemaOptionality(required, json))

      return
    }

    const error = new OpenAPIGeneratorError(
      'When output structure is "detailed", output schema must satisfy: '
      + '{ headers?: Record<string, unknown>, body?: unknown }',
    )

    if (!isObjectSchema(json)) {
      throw error
    }

    if (json.properties?.headers !== undefined) {
      if (!isObjectSchema(json.properties.headers)) {
        throw error
      }

      for (const key in json.properties.headers.properties) {
        ref.responses[status].headers ??= {}
        ref.responses[status].headers[key] = {
          schema: toOpenAPISchema(json.properties.headers.properties[key]!) as any,
          required: json.properties.headers.required?.includes(key),
        }
      }
    }

    if (json.properties?.body !== undefined) {
      ref.responses[status].content = toOpenAPIContent(
        applySchemaOptionality(json.required?.includes('body') ?? false, json.properties.body),
      )
    }
  }

  #errorResponse(ref: OpenAPI.OperationObject, def: AnyContractProcedure['~orpc']): void {
    const errorMap = def.errorMap as ErrorMap

    const errors: Record<string, JSONSchema[]> = {}

    for (const code in errorMap) {
      const config = errorMap[code]

      if (!config) {
        continue
      }

      const status = fallbackORPCErrorStatus(code, config.status)
      const message = fallbackORPCErrorMessage(code, config.message)

      const [dataRequired, dataSchema] = this.converter.convert(config.data, { strategy: 'output' })

      errors[status] ??= []
      errors[status].push({
        type: 'object',
        properties: {
          defined: { const: true },
          code: { const: code },
          status: { const: status },
          message: { type: 'string', default: message },
          data: dataSchema,
        },
        required: dataRequired ? ['defined', 'code', 'status', 'message', 'data'] : ['defined', 'code', 'status', 'message'],
      })
    }

    ref.responses ??= {}

    for (const status in errors) {
      const schemas = errors[status]!

      ref.responses[status] = {
        description: status,
        content: toOpenAPIContent({
          oneOf: [
            ...schemas,
            {
              type: 'object',
              properties: {
                defined: { const: false },
                code: { type: 'string' },
                status: { type: 'number' },
                message: { type: 'string' },
                data: {},
              },
              required: ['defined', 'code', 'status', 'message'],
            },
          ],
        }),
      }
    }
  }
}
