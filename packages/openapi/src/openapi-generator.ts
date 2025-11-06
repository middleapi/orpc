import type { AnyContractProcedure, AnyContractRouter, AnySchema, ErrorMap, OpenAPI } from '@orpc/contract'
import type { StandardOpenAPIJsonSerializerOptions } from '@orpc/openapi-client/standard'
import type { AnyProcedure, AnyRouter, TraverseContractProcedureCallbackOptions } from '@orpc/server'
import type { Value } from '@orpc/shared'
import type { JSONSchema } from './schema'
import type { ConditionalSchemaConverter, SchemaConverter, SchemaConverterComponent, SchemaConvertOptions } from './schema-converter'
import { fallbackORPCErrorMessage, fallbackORPCErrorStatus, isORPCErrorStatus } from '@orpc/client'
import { toHttpPath } from '@orpc/client/standard'
import { fallbackContractConfig, getEventIteratorSchemaDetails } from '@orpc/contract'
import { getDynamicParams, StandardOpenAPIJsonSerializer } from '@orpc/openapi-client/standard'
import { resolveContractProcedures } from '@orpc/server'
import { clone, stringifyJSON, toArray, value } from '@orpc/shared'
import { applyCustomOpenAPIOperation } from './openapi-custom'
import { checkParamsSchema, resolveOpenAPIJsonSchemaRef, simplifyComposedObjectJsonSchemasAndRefs, toOpenAPIContent, toOpenAPIEventIteratorContent, toOpenAPIMethod, toOpenAPIParameters, toOpenAPIPath, toOpenAPISchema } from './openapi-utils'
import { CompositeSchemaConverter } from './schema-converter'
import { applySchemaOptionality, expandUnionSchema, isAnySchema, isObjectSchema, separateObjectSchema } from './schema-utils'

class OpenAPIGeneratorError extends Error { }

export interface OpenAPIGeneratorOptions extends StandardOpenAPIJsonSerializerOptions {
  schemaConverters?: ConditionalSchemaConverter[]
}

export interface OpenAPIGeneratorGenerateOptions extends Partial<Omit<OpenAPI.Document, 'openapi'>> {
  /**
   * Exclude procedures from the OpenAPI specification.
   *
   * @deprecated Use `filter` option instead.
   * @default () => false
   */
  exclude?: (procedure: AnyProcedure | AnyContractProcedure, path: readonly string[]) => boolean

  /**
   * Filter procedures. Return `false` to exclude a procedure from the OpenAPI specification.
   *
   * @default true
   */
  filter?: Value<boolean, [options: TraverseContractProcedureCallbackOptions]>

  /**
   * Common schemas to be used for $ref resolution.
   */
  commonSchemas?: Record<string, {
    /**
     * Determines which schema definition to use when input and output schemas differ.
     * This is needed because some schemas transform data differently between input and output,
     * making it impossible to use a single $ref for both cases.
     *
     * @example
     * ```ts
     * // This schema transforms a string input into a number output
     * const Schema = z.string()
     *   .transform(v => Number(v))
     *   .pipe(z.number())
     *
     * // Input schema:  { type: 'string' }
     * // Output schema: { type: 'number' }
     * ```
     *
     * When schemas differ between input and output, you must explicitly choose
     * which version to use for the OpenAPI specification.
     *
     * @default 'input' - Uses the input schema definition by default
     */
    strategy?: SchemaConvertOptions['strategy']
    schema: AnySchema
  } | {
    error: 'UndefinedError'
    schema?: never
  }>

  /**
   * Define a custom JSON schema for the error response body when using
   * type-safe errors. Helps align ORPC error formatting with existing API
   * response standards or conventions.
   *
   * @remarks
   * - Return `null | undefined` to use the default error response body shaper.
   */
  customErrorResponseBodySchema?: Value<
    JSONSchema | undefined | null,
    [definedErrors: [code: string, defaultMessage: string, dataRequired: boolean, dataSchema: JSONSchema][], status: number]
  >
}

/**
 * The generator that converts oRPC routers/contracts to OpenAPI specifications.
 *
 * @see {@link https://orpc.unnoq.com/docs/openapi/openapi-specification OpenAPI Specification Docs}
 */
export class OpenAPIGenerator {
  private readonly serializer: StandardOpenAPIJsonSerializer
  private readonly converter: SchemaConverter

  constructor(options: OpenAPIGeneratorOptions = {}) {
    this.serializer = new StandardOpenAPIJsonSerializer(options)
    this.converter = new CompositeSchemaConverter(toArray(options.schemaConverters))
  }

  /**
   * Generates OpenAPI specifications from oRPC routers/contracts.
   *
   * @see {@link https://orpc.unnoq.com/docs/openapi/openapi-specification OpenAPI Specification Docs}
   */
  async generate(
    router: AnyContractRouter | AnyRouter,
    { customErrorResponseBodySchema, commonSchemas, filter: baseFilter, exclude, ...baseDoc }: OpenAPIGeneratorGenerateOptions = {},
  ): Promise<OpenAPI.Document> {
    const filter = baseFilter
      ?? (({ contract, path }: TraverseContractProcedureCallbackOptions) => {
        return !(exclude?.(contract, path) ?? false)
      })

    const doc: OpenAPI.Document = {
      ...clone(baseDoc),
      info: baseDoc.info ?? { title: 'API Reference', version: '0.0.0' },
      openapi: '3.1.1',
    } as OpenAPI.Document

    const { baseSchemaConvertOptions, undefinedErrorJsonSchema } = await this.#resolveCommonSchemas(doc, commonSchemas)

    const contracts: TraverseContractProcedureCallbackOptions[] = []

    await resolveContractProcedures({ path: [], router }, (traverseOptions) => {
      if (!value(filter, traverseOptions)) {
        return
      }

      contracts.push(traverseOptions)
    })

    const errors: string[] = []

    for (const { contract, path } of contracts) {
      const stringPath = path.join('.')

      try {
        const def = contract['~orpc']

        const method = toOpenAPIMethod(fallbackContractConfig('defaultMethod', def.route.method))
        const httpPath = toOpenAPIPath(def.route.path ?? toHttpPath(path))

        let operationObjectRef: OpenAPI.OperationObject

        if (def.route.spec !== undefined && typeof def.route.spec !== 'function') {
          operationObjectRef = def.route.spec
        }
        else {
          operationObjectRef = {
            operationId: def.route.operationId ?? stringPath,
            summary: def.route.summary,
            description: def.route.description,
            deprecated: def.route.deprecated,
            tags: def.route.tags?.map(tag => tag),
          }

          await this.#request(doc, operationObjectRef, def, baseSchemaConvertOptions)
          await this.#successResponse(doc, operationObjectRef, def, baseSchemaConvertOptions)
          await this.#errorResponse(operationObjectRef, def, baseSchemaConvertOptions, undefinedErrorJsonSchema, customErrorResponseBodySchema)
        }

        if (typeof def.route.spec === 'function') {
          operationObjectRef = def.route.spec(operationObjectRef)
        }

        doc.paths ??= {}
        doc.paths[httpPath] ??= {}
        doc.paths[httpPath][method] = applyCustomOpenAPIOperation(operationObjectRef, contract) as any
      }
      catch (e) {
        if (!(e instanceof OpenAPIGeneratorError)) {
          throw e
        }

        errors.push(
          `[OpenAPIGenerator] Error occurred while generating OpenAPI for procedure at path: ${stringPath}\n${e.message}`,
        )
      }
    }

    if (errors.length) {
      throw new OpenAPIGeneratorError(
        `Some error occurred during OpenAPI generation:\n\n${errors.join('\n\n')}`,
      )
    }

    return this.serializer.serialize(doc)[0] as OpenAPI.Document
  }

  async #resolveCommonSchemas(doc: OpenAPI.Document, commonSchemas: OpenAPIGeneratorGenerateOptions['commonSchemas']): Promise<{
    baseSchemaConvertOptions: Pick<SchemaConvertOptions, 'components'>
    undefinedErrorJsonSchema: JSONSchema
  }> {
    let undefinedErrorJsonSchema: JSONSchema = {
      type: 'object',
      properties: {
        defined: { const: false },
        code: { type: 'string' },
        status: { type: 'number' },
        message: { type: 'string' },
        data: {},
      },
      required: ['defined', 'code', 'status', 'message'],
    }
    const baseSchemaConvertOptions: { components?: SchemaConverterComponent[] } = {}

    if (commonSchemas) {
      baseSchemaConvertOptions.components = []

      for (const key in commonSchemas) {
        const options = commonSchemas[key]!

        if (options.schema === undefined) {
          continue
        }

        const { schema, strategy = 'input' } = options

        const [required, json] = await this.converter.convert(schema, { strategy })

        const allowedStrategies: SchemaConvertOptions['strategy'][] = [strategy]

        if (strategy === 'input') {
          const [outputRequired, outputJson] = await this.converter.convert(schema, { strategy: 'output' })

          if (outputRequired === required && stringifyJSON(outputJson) === stringifyJSON(json)) {
            allowedStrategies.push('output')
          }
        }
        else if (strategy === 'output') {
          const [inputRequired, inputJson] = await this.converter.convert(schema, { strategy: 'input' })

          if (inputRequired === required && stringifyJSON(inputJson) === stringifyJSON(json)) {
            allowedStrategies.push('input')
          }
        }

        baseSchemaConvertOptions.components.push({
          schema,
          required,
          ref: `#/components/schemas/${key}`,
          allowedStrategies,
        })
      }

      doc.components ??= {}
      doc.components.schemas ??= {}

      for (const key in commonSchemas) {
        const options = commonSchemas[key]!

        if (options.schema === undefined) {
          if (options.error === 'UndefinedError') {
            doc.components.schemas[key] = toOpenAPISchema(undefinedErrorJsonSchema)
            undefinedErrorJsonSchema = { $ref: `#/components/schemas/${key}` }
          }

          continue
        }

        const { schema, strategy = 'input' } = options

        const [, json] = await this.converter.convert(
          schema,
          {
            ...baseSchemaConvertOptions,
            strategy,
            minStructureDepthForRef: 1, // not allow use $ref for root schemas
          },
        )
        doc.components.schemas[key] = toOpenAPISchema(json)
      }
    }

    return { baseSchemaConvertOptions, undefinedErrorJsonSchema }
  }

  async #request(
    doc: OpenAPI.Document,
    ref: OpenAPI.OperationObject,
    def: AnyContractProcedure['~orpc'],
    baseSchemaConvertOptions: Pick<SchemaConvertOptions, 'components'>,
  ): Promise<void> {
    const method = fallbackContractConfig('defaultMethod', def.route.method)
    const details = getEventIteratorSchemaDetails(def.inputSchema)

    if (details) {
      ref.requestBody = {
        required: true,
        content: toOpenAPIEventIteratorContent(
          await this.converter.convert(details.yields, { ...baseSchemaConvertOptions, strategy: 'input' }),
          await this.converter.convert(details.returns, { ...baseSchemaConvertOptions, strategy: 'input' }),
        ),
      }

      return
    }

    const dynamicParams = getDynamicParams(def.route.path)?.map(v => v.name)
    const inputStructure = fallbackContractConfig('defaultInputStructure', def.route.inputStructure)

    let [required, schema] = await this.converter.convert(
      def.inputSchema,
      {
        ...baseSchemaConvertOptions,
        strategy: 'input',
      },
    )

    if (isAnySchema(schema) && !dynamicParams?.length) {
      return
    }

    if (inputStructure === 'detailed' || (inputStructure === 'compact' && (dynamicParams?.length || method === 'GET'))) {
      schema = simplifyComposedObjectJsonSchemasAndRefs(schema, doc)
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

    const resolvedParamSchema = schema.properties?.params !== undefined
      ? simplifyComposedObjectJsonSchemasAndRefs(schema.properties.params, doc)
      : undefined

    if (
      dynamicParams?.length && (
        resolvedParamSchema === undefined
        || !isObjectSchema(resolvedParamSchema)
        || !checkParamsSchema(resolvedParamSchema, dynamicParams)
      )
    ) {
      throw new OpenAPIGeneratorError(
        'When input structure is "detailed" and path has dynamic params, the "params" schema must be an object with all dynamic params as required.',
      )
    }

    for (const from of ['params', 'query', 'headers']) {
      const fromSchema = schema.properties?.[from]
      if (fromSchema !== undefined) {
        const resolvedSchema = simplifyComposedObjectJsonSchemasAndRefs(fromSchema, doc)

        if (!isObjectSchema(resolvedSchema)) {
          throw error
        }

        const parameterIn: 'path' | 'query' | 'header' = from === 'params'
          ? 'path'
          : from === 'headers'
            ? 'header'
            : 'query'

        ref.parameters ??= []
        ref.parameters.push(...toOpenAPIParameters(resolvedSchema, parameterIn))
      }
    }

    if (schema.properties?.body !== undefined) {
      ref.requestBody = {
        required: schema.required?.includes('body'),
        content: toOpenAPIContent(schema.properties.body),
      }
    }
  }

  async #successResponse(
    doc: OpenAPI.Document,
    ref: OpenAPI.OperationObject,
    def: AnyContractProcedure['~orpc'],
    baseSchemaConvertOptions: Pick<SchemaConvertOptions, 'components'>,
  ): Promise<void> {
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
          await this.converter.convert(eventIteratorSchemaDetails.yields, { ...baseSchemaConvertOptions, strategy: 'output' }),
          await this.converter.convert(eventIteratorSchemaDetails.returns, { ...baseSchemaConvertOptions, strategy: 'output' }),
        ),
      }

      return
    }

    const [required, json] = await this.converter.convert(
      outputSchema,
      {
        ...baseSchemaConvertOptions,
        strategy: 'output',
        minStructureDepthForRef: outputStructure === 'detailed' ? 1 : 0,
      },
    )

    if (outputStructure === 'compact') {
      ref.responses ??= {}
      ref.responses[status] = {
        description,
      }

      ref.responses[status].content = toOpenAPIContent(applySchemaOptionality(required, json))

      return
    }

    const handledStatuses = new Set<number>()

    for (const item of expandUnionSchema(json)) {
      const error = new OpenAPIGeneratorError(`
        When output structure is "detailed", output schema must satisfy:
        { 
          status?: number, // must be a literal number and in the range of 200-399
          headers?: Record<string, unknown>, 
          body?: unknown 
        }
        
        But got: ${stringifyJSON(item)}
      `)

      const simplifiedItem = simplifyComposedObjectJsonSchemasAndRefs(item, doc)

      if (!isObjectSchema(simplifiedItem)) {
        throw error
      }

      let schemaStatus: number | undefined
      let schemaDescription: string | undefined

      if (simplifiedItem.properties?.status !== undefined) {
        const statusSchema = resolveOpenAPIJsonSchemaRef(doc, simplifiedItem.properties.status)

        if (typeof statusSchema !== 'object'
          || statusSchema.const === undefined
          || typeof statusSchema.const !== 'number'
          || !Number.isInteger(statusSchema.const)
          || isORPCErrorStatus(statusSchema.const)
        ) {
          throw error
        }

        schemaStatus = statusSchema.const
        schemaDescription = statusSchema.description
      }

      const itemStatus = schemaStatus ?? status
      const itemDescription = schemaDescription ?? description

      if (handledStatuses.has(itemStatus)) {
        throw new OpenAPIGeneratorError(`
          When output structure is "detailed", each success status must be unique.
          But got status: ${itemStatus} used more than once.
        `)
      }

      handledStatuses.add(itemStatus)

      ref.responses ??= {}
      ref.responses[itemStatus] = {
        description: itemDescription,
      }

      if (simplifiedItem.properties?.headers !== undefined) {
        const headersSchema = simplifyComposedObjectJsonSchemasAndRefs(simplifiedItem.properties.headers, doc)

        if (!isObjectSchema(headersSchema)) {
          throw error
        }

        for (const key in headersSchema.properties) {
          const headerSchema = headersSchema.properties[key]

          if (headerSchema !== undefined) {
            ref.responses[itemStatus].headers ??= {}
            ref.responses[itemStatus].headers[key] = {
              schema: toOpenAPISchema(headerSchema) as any,
              required: simplifiedItem.required?.includes('headers') && headersSchema.required?.includes(key),
            }
          }
        }
      }

      if (simplifiedItem.properties?.body !== undefined) {
        ref.responses[itemStatus].content = toOpenAPIContent(
          applySchemaOptionality(simplifiedItem.required?.includes('body') ?? false, simplifiedItem.properties.body),
        )
      }
    }
  }

  async #errorResponse(
    ref: OpenAPI.OperationObject,
    def: AnyContractProcedure['~orpc'],
    baseSchemaConvertOptions: Pick<SchemaConvertOptions, 'components'>,
    undefinedErrorSchema: JSONSchema,
    customErrorResponseBodySchema: OpenAPIGeneratorGenerateOptions['customErrorResponseBodySchema'],
  ): Promise<void> {
    const errorMap = def.errorMap as ErrorMap

    const errorResponsesByStatus: Record<string, {
      status: number
      errorSchemaVariants: JSONSchema[]
      definedErrorDefinitions: [code: string, defaultMessage: string, required: boolean, schema: JSONSchema][]
    }> = {}

    for (const code in errorMap) {
      const config = errorMap[code]

      if (!config) {
        continue
      }

      const status = fallbackORPCErrorStatus(code, config.status)
      const defaultMessage = fallbackORPCErrorMessage(code, config.message)

      errorResponsesByStatus[status] ??= { status, definedErrorDefinitions: [], errorSchemaVariants: [] }

      const [dataRequired, dataSchema] = await this.converter.convert(config.data, { ...baseSchemaConvertOptions, strategy: 'output' })

      errorResponsesByStatus[status].definedErrorDefinitions.push([code, defaultMessage, dataRequired, dataSchema])
      errorResponsesByStatus[status].errorSchemaVariants.push({
        type: 'object',
        properties: {
          defined: { const: true },
          code: { const: code },
          status: { const: status },
          message: { type: 'string', default: defaultMessage },
          data: dataSchema,
        },
        required: dataRequired ? ['defined', 'code', 'status', 'message', 'data'] : ['defined', 'code', 'status', 'message'],
      })
    }

    ref.responses ??= {}

    for (const statusString in errorResponsesByStatus) {
      const errorResponse = errorResponsesByStatus[statusString]!

      const customBodySchema = value(customErrorResponseBodySchema, errorResponse.definedErrorDefinitions, errorResponse.status)

      ref.responses[statusString] = {
        description: statusString,
        content: toOpenAPIContent(customBodySchema ?? {
          oneOf: [
            ...errorResponse.errorSchemaVariants,
            undefinedErrorSchema,
          ],
        }),
      }
    }
  }
}
