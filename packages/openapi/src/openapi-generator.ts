// eslint-disable-next-line no-restricted-imports
import type { OpenAPIV3_1 } from '@hey-api/spec-types'
import type { AnyProcedureContract, AnySchema, ErrorMap, RouterContract } from '@orpc/contract'
import type { JsonSchema, JsonSchemaConverter, JsonSchemaConverterDirection } from '@orpc/json-schema'
import type { AnyProcedure, AnyRouter } from '@orpc/server'
import type { Value } from '@orpc/shared'
import type { OpenAPIMeta } from './meta'
import type { OpenAPIDocument, OpenAPIOperationObject } from './types'
import { COMMON_ERROR_STATUS_MAP } from '@orpc/client'
import { getEventIteratorSchemaDetails } from '@orpc/contract'
import {
  combineJsonObjectSchemaEntries,
  combineJsonSchemasWithComposition,
  decodeJsonPointerSegment,
  DelegatingJsonSchemaConverter,
  encodeJsonPointerSegment,
  ensureJsonSchemaObject,
  extractJsonObjectSchemaEntries,
  flattenJsonUnionSchema,
  isJsonFileSchema,
  isJsonPrimitiveSchema,
  isUnconstrainedSchema,
  mapJsonSchemaRefs,
  matchArrayableJsonSchema,
  StandardJsonSchemaConverter,
} from '@orpc/json-schema'
import { DEFAULT_ERROR_STATUS, DEFAULT_SUCCESS_STATUS, walkProcedureContractsAsync } from '@orpc/server'
import { clone, findDeepMatches, isDeepEqual, isPlainObject, mergeHttpPath, pathToHttpPath, stringifyJSON, toArray, value } from '@orpc/shared'
import {
  DEFAULT_OPENAPI_INPUT_STRUCTURE,
  DEFAULT_OPENAPI_METHOD,
  DEFAULT_OPENAPI_OUTPUT_STRUCTURE,
  DEFAULT_OPENAPI_SUCCESS_DESCRIPTION,
} from './constants'
import { getOpenAPIMeta } from './meta'
import { OpenAPISerializer } from './openapi-serializer'
import { getDynamicPathParams } from './utils'

type DynamicPathParam = NonNullable<ReturnType<typeof getDynamicPathParams>>[number]

export class OpenAPIGeneratorError extends TypeError { }

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
    [
      definedErrors: { code: string, defaultMessage: string | undefined, dataOptional: boolean, dataJsonSchema: JsonSchema }[],
      status: number,
    ]
  >

  /**
   * Mapping ORPCError Code -> HTTP Status Code
   *
   * @default COMMON_ERROR_STATUS_MAP, DEFAULT_ERROR_STATUS
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

    const errors: string[] = []

    await walkProcedureContractsAsync(router, async (contract, path) => {
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

        let operationRef: OpenAPIOperationObject

        if (meta?.spec !== undefined && typeof meta.spec !== 'function') {
          operationRef = meta.spec
        }
        else {
          operationRef = {
            operationId: meta?.operationId ?? path.join('.'),
            summary: meta?.summary,
            description: meta?.description,
            deprecated: meta?.deprecated,
            tags: meta?.tags?.map(tag => tag),
          }

          await this.request(doc, operationRef, def, meta, dynamicPathParams, options, path)
          await this.successResponse(doc, operationRef, def, meta, options, path)
          await this.errorResponse(doc, operationRef, def, meta, options)
        }

        if (typeof meta?.spec === 'function') {
          operationRef = meta.spec(operationRef)
        }

        doc.paths ??= {}
        doc.paths[openApiPath] ??= {}
        doc.paths[openApiPath][method] = operationRef
      }
      catch (e) {
        if (!(e instanceof OpenAPIGeneratorError)) {
          throw e
        }
        errors.push(
          `[OpenAPIGenerator] Error occurred while generating OpenAPI for procedure at path: ${path.join('.')}\n${e.message}`,
        )
      }
    })

    if (errors.length) {
      throw new OpenAPIGeneratorError(
        `Some error occurred during OpenAPI generation:\n\n${errors.join('\n\n')}`,
      )
    }

    return this.serializer.serialize(doc, { asFormData: false, useFormDataForBlobFields: false }) as OpenAPIDocument
  }

  private async convertSchema(schema: AnySchema | undefined, direction: JsonSchemaConverterDirection): Promise<[JsonSchema, boolean]> {
    const [jsonSchema, optional] = await this.converter.convert(schema as any, direction)
    return [strip$schemaField(jsonSchema), optional]
  }

  private async convertSchemas(schemas: AnySchema[] | undefined, direction: JsonSchemaConverterDirection): Promise<[JsonSchema, boolean]> {
    if (!schemas || schemas.length <= 1) {
      return this.convertSchema(schemas?.[0], direction)
    }

    const results = await Promise.all(schemas.map(s => this.convertSchema(s, direction)))
    const allOfSchemas: JsonSchema[] = []
    let optional = true

    for (const [jsonSchema, opt] of results) {
      allOfSchemas.push(jsonSchema)
      if (!opt) {
        optional = false
      }
    }

    return [combineJsonSchemasWithComposition('allOf', allOfSchemas), optional]
  }

  private async request(
    doc: OpenAPIDocument,
    ref: OpenAPIOperationObject,
    def: AnyProcedureContract['~orpc'],
    meta: OpenAPIMeta | undefined,
    dynamicPathParams: DynamicPathParam[] | undefined,
    options: OpenAPIGeneratorGenerateOptions,
    path: string[],
  ): Promise<void> {
    const method = meta?.method ?? DEFAULT_OPENAPI_METHOD
    const inputStructure = meta?.inputStructure ?? DEFAULT_OPENAPI_INPUT_STRUCTURE
    const inputSchemas = def.inputSchemas

    if (inputStructure === 'compact') {
      const eventIteratorDetails = getEventIteratorDetails(inputSchemas)

      if (eventIteratorDetails) {
        const [yieldSchemas, returnSchemas] = eventIteratorDetails
        const yieldResult = await this.convertSchemas(yieldSchemas, 'input')
        const returnResult = await this.convertSchemas(returnSchemas, 'input')

        ref.requestBody = {
          required: true,
          content: toEventIteratorContent(yieldResult, returnResult, doc, options),
        }

        return
      }
    }

    const dynamicParams = dynamicPathParams?.map(v => v.parameterName)

    const [schema, optional] = await this.convertSchemas(inputSchemas, 'input')

    if (isUnconstrainedSchema(schema) && !dynamicParams?.length) {
      return
    }

    const objectSchemaEntries = extractJsonObjectSchemaEntries(schema)

    if (!objectSchemaEntries) {
      if (inputStructure === 'detailed') {
        throw new OpenAPIGeneratorError(
          `Procedure at path "${path.join('.')}" has inputStructure "detailed" but its input schema is not an object.\n`
          + `  Expected shape: { params?: Record<string, unknown>, query?: Record<string, unknown>, headers?: Record<string, unknown>, body?: unknown }`,
        )
      }

      if (method === 'GET') {
        throw new OpenAPIGeneratorError(
          `Procedure at path "${path.join('.')}" uses method "GET" but its input schema is not an object.\n`
          + `  GET procedures map all input fields to query parameters, so the schema must be an object.\n`
          + `  Expected: Record<string, unknown>`,
        )
      }
    }

    const paramsObjectSchemaEntries = inputStructure === 'compact'
      ? objectSchemaEntries?.filter(([name]) => dynamicParams?.includes(name))
      : extractJsonObjectSchemaEntries(objectSchemaEntries?.find(([name]) => name === 'params')?.[1] ?? false)
    const queryObjectSchemaEntries = inputStructure === 'compact'
      ? method === 'GET' ? objectSchemaEntries?.filter(([name]) => !dynamicParams?.includes(name)) : undefined
      : extractJsonObjectSchemaEntries(objectSchemaEntries?.find(([name]) => name === 'query')?.[1] ?? false)
    const headersObjectSchemaEntries = inputStructure === 'compact'
      ? undefined
      : extractJsonObjectSchemaEntries(objectSchemaEntries?.find(([name]) => name === 'headers')?.[1] ?? false)
    const bodySchema = inputStructure === 'compact'
      ? method === 'GET' || method === 'HEAD' ? undefined : (!dynamicParams?.length ? schema : objectSchemaEntries ? combineJsonObjectSchemaEntries(objectSchemaEntries?.filter(([name]) => !dynamicParams?.includes(name))) : undefined)
      : objectSchemaEntries?.find(([name]) => name === 'body')?.[1]

    if (dynamicParams?.length) {
      if (!paramsObjectSchemaEntries) {
        throw new OpenAPIGeneratorError(
          `Procedure at path "${path.join('.')}" has dynamic path params (${dynamicParams.map(p => p).join(', ')}) but its input schema is not an object.\n`
          + `  Each dynamic param must appear as a required key in the schema.`,
        )
      }

      dynamicParams.forEach((name) => {
        const entry = paramsObjectSchemaEntries.find(([n]) => n === name)

        if (!entry) {
          throw new OpenAPIGeneratorError(
            `Procedure at path "${path.join('.')}" is missing dynamic param "${name}" in its input schema.\n`
            + `  Route params: ${dynamicParams.map(p => `{${p}}`).join(', ')}\n`
            + `  Schema keys:  ${paramsObjectSchemaEntries.map(([n]) => n).join(', ') || '(none)'}`,
          )
        }

        if (entry[2]) {
          throw new OpenAPIGeneratorError(
            `Procedure at path "${path.join('.')}" has dynamic param "${name}" marked as optional in its input schema, but path params must always be required in OpenAPI.`,
          )
        }

        ref.parameters ??= []
        ref.parameters.push({
          in: 'path',
          required: true,
          name,
          schema: toOpenAPISchema(entry[1], doc, options),
        })
      })
    }

    if (queryObjectSchemaEntries) {
      queryObjectSchemaEntries.forEach(([name, schema, optional]) => {
        const style = meta?.queryStyles?.[name]
        const parameter: Exclude<typeof ref.parameters, undefined>[number] = {
          in: 'query',
          name,
          schema: toOpenAPISchema(schema, doc, options),
          allowEmptyValue: true,
          allowReserved: true,
        }

        if (!optional) {
          parameter.required = true
        }

        if (style === 'comma-delimited-array' || style === 'comma-delimited-object') {
          parameter.explode = false
        }
        else if (style === 'pipe-delimited-array' || style === 'pipe-delimited-object') {
          parameter.style = 'pipeDelimited'
        }
        else if (style === 'space-delimited-array' || style === 'space-delimited-object') {
          parameter.style = 'spaceDelimited'
        }
        else if (style === 'json') {
          parameter.content = {
            'application/json': { schema: parameter.schema },
          }
          delete parameter.schema
        }
        else if (style === undefined) {
          if (flattenJsonUnionSchema(schema).some(s => !isJsonPrimitiveSchema(s))) {
            const arrayable = matchArrayableJsonSchema(schema)

            if (!arrayable || flattenJsonUnionSchema(arrayable[0]).some(s => !isJsonPrimitiveSchema(s))) {
              parameter.style = 'deepObject'
              parameter.explode = true
            }
          }
        }
        else {
          const _expect: 'primitive' | 'array' = style
        }

        ref.parameters ??= []
        ref.parameters.push(parameter)
      })
    }

    if (headersObjectSchemaEntries) {
      headersObjectSchemaEntries.forEach(([name, schema, optional]) => {
        ref.parameters ??= []
        ref.parameters.push({
          in: 'header',
          name,
          required: optional ? undefined : true,
          schema: toOpenAPISchema(schema, doc, options),
        })
      })
    }

    if (bodySchema !== undefined) {
      const bodyOptional = inputStructure === 'compact'
        ? !dynamicParams?.length ? optional : objectSchemaEntries?.filter(([name]) => !dynamicParams?.includes(name)).every(([,,optional]) => optional)
        : objectSchemaEntries?.find(([name]) => name === 'body')?.[2]

      ref.requestBody = {
        required: bodyOptional ? undefined : true,
        content: toBodyContent(bodySchema, doc, options),
      }
    }
  }

  private async successResponse(
    doc: OpenAPIDocument,
    ref: OpenAPIOperationObject,
    def: AnyProcedureContract['~orpc'],
    meta: OpenAPIMeta | undefined,
    options: OpenAPIGeneratorGenerateOptions,
    path: string[],
  ): Promise<void> {
    const outputSchemas = def.outputSchemas
    const status = meta?.successStatus ?? DEFAULT_SUCCESS_STATUS
    const description = meta?.successDescription ?? DEFAULT_OPENAPI_SUCCESS_DESCRIPTION
    const outputStructure = meta?.outputStructure ?? DEFAULT_OPENAPI_OUTPUT_STRUCTURE

    if (outputStructure === 'compact') {
      const eventDetails = getEventIteratorDetails(outputSchemas)

      if (eventDetails) {
        const [yieldSchemas, returnSchemas] = eventDetails
        const yieldResult = await this.convertSchemas(yieldSchemas, 'output')
        const returnResult = await this.convertSchemas(returnSchemas, 'output')

        ref.responses ??= {}
        ref.responses[status] = {
          description,
          content: toEventIteratorContent(yieldResult, returnResult, doc, options),
        }

        return
      }
    }

    const [schema] = await this.convertSchemas(outputSchemas, 'output')

    if (isUnconstrainedSchema(schema) || outputStructure === 'compact') {
      ref.responses ??= {}
      ref.responses[status] = {
        description,
        content: toBodyContent(schema, doc, options),
      }
      return
    }

    const schemasByStatus = new Map<number, { description: string | undefined, body: JsonSchema | undefined, headers: JsonSchema | undefined }[]>()

    for (const item of flattenJsonUnionSchema(schema)) {
      const objectSchemaEntries = extractJsonObjectSchemaEntries(item)

      if (!objectSchemaEntries) {
        throw new OpenAPIGeneratorError(
          `Procedure at path "${path.join('.')}" has outputStructure "detailed" but its output schema is not an object.\n`
          + `  Expected shape: { status?: number (less than 400), headers?: Record<string, string | string[]>, body?: unknown }`,
        )
      }

      const statusSchema = objectSchemaEntries?.find(([name]) => name === 'status')?.[1]

      if (statusSchema !== undefined && (typeof statusSchema !== 'object' || !Number.isInteger(statusSchema.const) || statusSchema.const >= 400)) {
        throw new OpenAPIGeneratorError(
          `Procedure at path "${path.join('.')}" has an invalid "status" field in its outputStructure "detailed" schema.\n`
          + `  Expected: a const integer less than 400\n`
          + `  Received: ${stringifyJSON(statusSchema)}`,

        )
      }

      const status = (statusSchema?.const as number || undefined) ?? meta?.successStatus ?? DEFAULT_SUCCESS_STATUS

      const description = statusSchema?.description
      const schemas = schemasByStatus.get(status)
      const headersSchema = objectSchemaEntries?.find(([name]) => name === 'headers')?.[1]
      const bodySchema = objectSchemaEntries?.find(([name]) => name === 'body')?.[1]

      if (schemas) {
        schemas.push({ description, headers: headersSchema, body: bodySchema })
      }
      else {
        schemasByStatus.set(status, [{ description, headers: headersSchema, body: bodySchema }])
      }
    }

    for (const [status, schemas] of schemasByStatus.entries()) {
      const descriptions = schemas.map(({ description }) => description).filter(d => d !== undefined)
      const responseObject: OpenAPIV3_1.ResponseObject = {
        description: descriptions.length ? descriptions.join(', ') : description,
      }

      const bodySchemas = schemas.map(({ body }) => body).filter(b => b !== undefined)
      if (bodySchemas.length) {
        responseObject.content = toBodyContent(combineJsonSchemasWithComposition('anyOf', bodySchemas), doc, options)
      }

      const headerSchemas = schemas.map(({ headers }) => headers).filter(b => b !== undefined)
      if (headerSchemas.length) {
        const entries = extractJsonObjectSchemaEntries(combineJsonSchemasWithComposition('anyOf', headerSchemas))
        entries?.forEach(([name, schema, optional]) => {
          responseObject.headers ??= {}
          responseObject.headers[name] = {
            required: optional ? undefined : true,
            schema: toOpenAPISchema(schema, doc, options),
          }
        })
      }
      ref.responses ??= {}
      ref.responses[status] = responseObject
    }
  }

  private async errorResponse(
    doc: OpenAPIDocument,
    ref: OpenAPIOperationObject,
    def: AnyProcedureContract['~orpc'],
    meta: OpenAPIMeta | undefined,
    options: OpenAPIGeneratorGenerateOptions,
  ): Promise<void> {
    const errorStatusMap: Record<string, number> = options.errorStatusMap ?? COMMON_ERROR_STATUS_MAP
    const errorMap: ErrorMap = def.errorMap

    const errorDefinitionsByStatus = new Map<
      number,
      { code: string, defaultMessage: string | undefined, dataOptional: boolean, dataJsonSchema: JsonSchema }[]
    >()

    for (const code in errorMap) {
      const config = errorMap[code]
      if (!config) {
        continue
      }

      const status = errorStatusMap[code] ?? DEFAULT_ERROR_STATUS
      const defaultMessage = config.message
      const [dataJsonSchema, dataOptional] = await this.convertSchema(config.data, 'output')

      const definitions = errorDefinitionsByStatus.get(status)
      if (definitions) {
        definitions.push({ code, dataJsonSchema, dataOptional, defaultMessage })
      }
      else {
        errorDefinitionsByStatus.set(status, [{ code, dataJsonSchema, dataOptional, defaultMessage }])
      }
    }

    if (errorDefinitionsByStatus.size) {
      const undefinedErrorSchema = hoistDefs({
        $defs: {
          UndefinedError: {
            type: 'object',
            properties: {
              defined: { const: false },
              inferable: { type: 'boolean' },
              code: { type: 'string' },
              status: { type: 'number' },
              message: { type: 'string' },
              data: {},
            },
            required: ['defined', 'inferable', 'code', 'status', 'message'],
          },
        },
        $ref: '#/$defs/UndefinedError',
      }, doc, options)

      for (const [status, definitions] of errorDefinitionsByStatus.entries()) {
        const descriptions = definitions.map(({ defaultMessage }) => defaultMessage).filter(m => m !== undefined)
        const customBodySchema = value(
          options.customErrorResponseBodySchema,
          definitions.map(def => ({ ...def, dataJsonSchema: hoistDefs(def.dataJsonSchema, doc, options) })),
          status,
        )
        const responseSchema = customBodySchema ?? combineJsonSchemasWithComposition('oneOf', [
          ...definitions.map(({ code, dataJsonSchema, dataOptional, defaultMessage }) => {
            return combineJsonObjectSchemaEntries([
              ['defined', { const: true }, false],
              ['inferable', { type: 'boolean' }, false],
              ['code', { const: code }, false],
              ['status', { const: status }, false],
              ['message', { type: 'string', default: defaultMessage }, false],
              ['data', dataJsonSchema, dataOptional],
            ])
          }),
          undefinedErrorSchema,
        ])

        ref.responses ??= {}
        ref.responses[status] = {
          description: descriptions.length ? descriptions.join(', ') : status.toString(),
          content: {
            'application/json': {
              schema: toOpenAPISchema(responseSchema, doc, options),
            },
          },
        } satisfies OpenAPIV3_1.ResponseObject
      }
    }
  }
}

function toOpenAPISchema(schema: JsonSchema, doc: OpenAPIDocument, options: OpenAPIGeneratorGenerateOptions): OpenAPIV3_1.SchemaObject {
  return ensureJsonSchemaObject(hoistDefs(
    schema,
    doc,
    options,
  )) as OpenAPIV3_1.SchemaObject
}

function toOpenAPIPath(path: `/${string}`, dynamicPathParams: DynamicPathParam[] | undefined): `/${string}` {
  if (!dynamicPathParams?.length) {
    return path
  }

  let normalized = ''
  let currentIndex = 0

  for (const param of dynamicPathParams) {
    normalized += path.slice(currentIndex, param.startIndex)
    normalized += `{${param.parameterName}}`
    currentIndex = param.startIndex + param.segment.length
  }

  normalized += path.slice(currentIndex)

  return normalized as `/${string}`
}

function strip$schemaField(schema: JsonSchema): JsonSchema {
  if (typeof schema !== 'object') {
    return schema
  }
  const { $schema, ...rest } = schema
  return rest
}

function getEventIteratorDetails(schemas: AnySchema[] | undefined): [yieldSchemas: AnySchema[], returnSchemas: AnySchema[]] | undefined {
  if (!schemas || schemas.length === 0) {
    return undefined
  }

  const yieldSchemas: AnySchema[] = []
  const returnSchemas: AnySchema[] = []

  for (const s of schemas) {
    const details = getEventIteratorSchemaDetails(s)
    if (!details) {
      return undefined
    }

    yieldSchemas.push(details.yieldSchema)
    if (details.returnSchema) {
      returnSchemas.push(details.returnSchema)
    }
  }

  return yieldSchemas.length || returnSchemas.length ? [yieldSchemas, returnSchemas] : undefined
}

function toEventIteratorContent(
  [yieldSchema, yieldOptional]: [JsonSchema, optional: boolean],
  [returnSchema, returnOptional]: [JsonSchema, optional: boolean],
  doc: OpenAPIDocument,
  options: OpenAPIGeneratorGenerateOptions,
): Record<string, any> {
  const schema = combineJsonSchemasWithComposition('oneOf', [
    combineJsonObjectSchemaEntries([
      ['event', { const: 'message' }, false],
      ['data', yieldSchema, yieldOptional],
      ['id', { type: 'string' }, true],
      ['retry', { type: 'number' }, true],
    ]),
    combineJsonObjectSchemaEntries([
      ['event', { const: 'close' }, false],
      ['data', returnSchema, returnOptional],
      ['id', { type: 'string' }, true],
      ['retry', { type: 'number' }, true],
    ]),
    {
      type: 'object',
      properties: {
        event: { const: 'error' },
        data: {},
        id: { type: 'string' },
        retry: { type: 'number' },
      },
      required: ['event'],
    },
  ])

  return {
    'text/event-stream': {
      schema: toOpenAPISchema(schema, doc, options),
    },
  }
}

function toBodyContent(schema: JsonSchema, doc: OpenAPIDocument, options: OpenAPIGeneratorGenerateOptions): Record<string, OpenAPIV3_1.MediaTypeObject> {
  const fileSchemasByMediaType = new Map<string, JsonSchema[]>()

  const rest = flattenJsonUnionSchema(schema).filter((s) => {
    if (!isJsonFileSchema(s)) {
      return !isUnconstrainedSchema(s)
    }

    const contentMediaType = s.contentMediaType ?? '*/*'
    const schemas = fileSchemasByMediaType.get(contentMediaType)
    if (schemas) {
      schemas.push(s)
    }
    else {
      fileSchemasByMediaType.set(contentMediaType, [s])
    }

    return false
  })

  const content: Record<string, OpenAPIV3_1.MediaTypeObject> = {}

  if (rest.length > 0) {
    const restSchema = fileSchemasByMediaType.size ? combineJsonSchemasWithComposition('anyOf', rest) : schema
    const hasNestedFiles = findDeepMatches(
      v => isPlainObject(v) && isJsonFileSchema(v as any),
      restSchema,
    ).values.length > 0

    const contentType = hasNestedFiles ? 'multipart/form-data' : 'application/json'
    const fileSchemas = fileSchemasByMediaType.get(contentType)
    fileSchemasByMediaType.delete(contentType)

    content[contentType] = {
      schema: toOpenAPISchema(combineJsonSchemasWithComposition('anyOf', [restSchema, ...toArray(fileSchemas)]), doc, options),
    }
  }

  for (const [contentType, schemas] of fileSchemasByMediaType.entries()) {
    content[contentType] = {
      schema: toOpenAPISchema(combineJsonSchemasWithComposition('anyOf', schemas), doc, options),
    }
  }

  return content
}

function hoistDefs(
  schema: JsonSchema,
  doc: OpenAPIDocument,
  options: OpenAPIGeneratorGenerateOptions,
): JsonSchema {
  if (typeof schema !== 'object') {
    return schema
  }

  if (!schema.$defs) {
    return schema
  }

  const { $defs, ...rest } = schema
  const localDefs: Record<string, Exclude<JsonSchema, boolean>> = {}
  const hoistedDefs: Record<string, Exclude<JsonSchema, boolean>> = {}

  for (const defName of Object.keys($defs)) {
    const defSchema = $defs[defName]

    if (defSchema === undefined) {
      continue
    }

    const normalized = normalizeHoistedDefSchema(defSchema)

    if (value(options.shouldHoistDef, defName, normalized) !== false) {
      hoistedDefs[defName] = normalized
    }
    else {
      localDefs[defName] = normalized
    }
  }

  hoistReferencedLocalDefs(hoistedDefs, localDefs)

  if (Object.keys(hoistedDefs).length === 0) {
    return schema
  }

  doc.components ??= {}
  doc.components.schemas ??= {}

  const componentsSchemas = doc.components.schemas
  const identityRenameMap = Object.fromEntries(
    Object.keys(hoistedDefs).map(defName => [defName, defName]),
  ) as Record<string, string>
  const renameMap: Record<string, string> = {}
  const pendingSchemas: { cleanSchema: Exclude<JsonSchema, boolean>, componentName: string }[] = []

  for (const defName of Object.keys(hoistedDefs)) {
    const cleanSchema = hoistedDefs[defName]!
    const existingSchema = componentsSchemas[defName]
    const candidateSchemas = Object.fromEntries(
      Object.keys(hoistedDefs).map(currentDefName => [
        currentDefName,
        rewriteComponentSchemaRefs(
          withReferencedLocalDefs(hoistedDefs[currentDefName]!, localDefs),
          {
            ...identityRenameMap,
            ...renameMap,
          },
        ),
      ]),
    ) as Record<string, JsonSchema>
    const prelimSchema = candidateSchemas[defName]!

    if (existingSchema !== undefined) {
      const reusableComponentName = findReusableComponentName(componentsSchemas, defName, prelimSchema, candidateSchemas)

      if (reusableComponentName !== undefined) {
        renameMap[defName] = reusableComponentName
        continue
      }

      const componentName = findUniqueComponentName(componentsSchemas, defName)

      renameMap[defName] = componentName
      pendingSchemas.push({ cleanSchema, componentName })
    }
    else {
      const reusableComponentName = findReusableComponentName(componentsSchemas, defName, prelimSchema, candidateSchemas)

      if (reusableComponentName !== undefined) {
        renameMap[defName] = reusableComponentName
        continue
      }

      renameMap[defName] = defName
      pendingSchemas.push({ cleanSchema, componentName: defName })
    }
  }

  for (const { cleanSchema, componentName } of pendingSchemas) {
    componentsSchemas[componentName] = rewriteComponentSchemaRefs(
      withReferencedLocalDefs(cleanSchema, localDefs),
      renameMap,
    ) as OpenAPIV3_1.SchemaObject
  }

  return rewriteComponentSchemaRefs(withReferencedLocalDefs(rest, localDefs), renameMap)
}

function normalizeHoistedDefSchema(schema: JsonSchema): Exclude<JsonSchema, boolean> {
  let cleanSchema = typeof schema === 'boolean'
    ? (schema ? {} : { not: {} })
    : { ...schema }

  if (cleanSchema.additionalProperties === false) {
    const { additionalProperties: _ignored, ...withoutAdditionalProperties } = cleanSchema
    cleanSchema = withoutAdditionalProperties
  }

  return cleanSchema
}

function hoistReferencedLocalDefs(
  hoistedDefs: Record<string, Exclude<JsonSchema, boolean>>,
  localDefs: Record<string, Exclude<JsonSchema, boolean>>,
): void {
  const queue = Object.values(hoistedDefs)

  while (queue.length > 0) {
    const current = queue.shift()

    if (current === undefined) {
      continue
    }

    visitSchemaRefs(current, (refName) => {
      const referenced = localDefs[refName]

      if (referenced === undefined) {
        return
      }

      hoistedDefs[refName] = referenced
      delete localDefs[refName]
      queue.push(referenced)
    })
  }
}

function withReferencedLocalDefs(
  schema: Exclude<JsonSchema, boolean>,
  localDefs: Record<string, Exclude<JsonSchema, boolean>>,
): Exclude<JsonSchema, boolean> {
  const referencedLocalDefs = collectReferencedLocalDefNames(schema, localDefs)

  if (referencedLocalDefs.length === 0) {
    return schema
  }

  const mergedDefs: Record<string, Exclude<JsonSchema, boolean>> = {
    ...(schema.$defs as Record<string, Exclude<JsonSchema, boolean>> | undefined),
  }

  for (const defName of referencedLocalDefs) {
    mergedDefs[defName] = localDefs[defName]!
  }

  return {
    ...schema,
    $defs: mergedDefs,
  }
}

function collectReferencedLocalDefNames(
  schema: JsonSchema,
  localDefs: Record<string, Exclude<JsonSchema, boolean>>,
): string[] {
  if (Object.keys(localDefs).length === 0) {
    return []
  }

  const referenced = new Set<string>()
  const queued = new Set<string>()
  const queue: JsonSchema[] = [schema]

  while (queue.length > 0) {
    const current = queue.shift()

    if (current === undefined) {
      continue
    }

    visitSchemaRefs(current, (refName) => {
      if (localDefs[refName] === undefined || referenced.has(refName)) {
        return
      }

      referenced.add(refName)

      if (!queued.has(refName)) {
        queued.add(refName)
        queue.push(localDefs[refName]!)
      }
    })
  }

  return [...referenced]
}

function visitSchemaRefs(schema: JsonSchema, onRef: (defName: string) => void, seen = new Set<object>()): void {
  if (typeof schema !== 'object' || schema === null) {
    return
  }

  if (seen.has(schema)) {
    return
  }

  seen.add(schema)

  if (typeof schema.$ref === 'string') {
    const refName = parseLocalDefRefName(schema.$ref)

    if (refName !== undefined) {
      onRef(refName)
    }
  }

  for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
    if (Array.isArray(schema[keyword])) {
      for (const item of schema[keyword]) {
        visitSchemaRefs(item, onRef, seen)
      }
    }
  }

  if (schema.properties) {
    for (const property of Object.values(schema.properties)) {
      visitSchemaRefs(property, onRef, seen)
    }
  }

  if (schema.items !== undefined) {
    visitSchemaRefs(schema.items, onRef, seen)
  }

  if (typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null) {
    visitSchemaRefs(schema.additionalProperties, onRef, seen)
  }

  if (schema.not !== undefined) {
    visitSchemaRefs(schema.not, onRef, seen)
  }

  if (schema.if !== undefined) {
    visitSchemaRefs(schema.if, onRef, seen)
  }

  if (schema.then !== undefined) {
    visitSchemaRefs(schema.then, onRef, seen)
  }

  if (schema.else !== undefined) {
    visitSchemaRefs(schema.else, onRef, seen)
  }

  if (Array.isArray(schema.prefixItems)) {
    for (const item of schema.prefixItems) {
      visitSchemaRefs(item, onRef, seen)
    }
  }

  if (schema.$defs) {
    for (const def of Object.values(schema.$defs)) {
      if (def !== undefined) {
        visitSchemaRefs(def, onRef, seen)
      }
    }
  }
}

function findUniqueComponentName(componentsSchemas: Record<string, any>, baseName: string): string {
  const candidate = `${baseName}`
  if (componentsSchemas[candidate] === undefined)
    return candidate

  let i = 2
  while (componentsSchemas[`${baseName}${i}`] !== undefined) {
    i++
  }
  return `${baseName}${i}`
}

function findReusableComponentName(
  componentsSchemas: Record<string, any>,
  defName: string,
  schema: JsonSchema,
  candidateSchemas: Record<string, JsonSchema>,
): string | undefined {
  const exactMatch = componentsSchemas[defName]

  if (
    exactMatch !== undefined
    && areSchemasEquivalentForReuse(
      schema,
      exactMatch,
      schema,
      exactMatch,
      candidateSchemas,
      componentsSchemas,
      new Map([[defName, defName]]),
      new Map([[defName, defName]]),
    )
  ) {
    return defName
  }

  for (const [componentName, componentSchema] of Object.entries(componentsSchemas)) {
    if (componentName === defName) {
      continue
    }

    if (areSchemasEquivalentForReuse(
      schema,
      componentSchema,
      schema,
      componentSchema,
      candidateSchemas,
      componentsSchemas,
      new Map([[defName, componentName]]),
      new Map([[componentName, defName]]),
    )) {
      return componentName
    }
  }

  return undefined
}

function areSchemasEquivalentForReuse(
  candidate: unknown,
  existing: unknown,
  candidateRootSchema: JsonSchema,
  existingRootSchema: JsonSchema,
  candidateSchemas: Record<string, JsonSchema>,
  existingSchemas: Record<string, any>,
  candidateToExistingComponentNames: Map<string, string>,
  existingToCandidateComponentNames: Map<string, string>,
  visited = new WeakMap<object, WeakSet<object>>(),
): boolean {
  if (candidate === existing) {
    return true
  }

  if (typeof candidate !== typeof existing) {
    return false
  }

  if (candidate === null || existing === null) {
    return candidate === existing
  }

  if (typeof candidate !== 'object' || typeof existing !== 'object') {
    return isDeepEqual(candidate, existing)
  }

  const seenExisting = visited.get(candidate)

  if (seenExisting?.has(existing)) {
    return true
  }

  if (seenExisting) {
    seenExisting.add(existing)
  }
  else {
    visited.set(candidate, new WeakSet([existing]))
  }

  if (Array.isArray(candidate) || Array.isArray(existing)) {
    if (!Array.isArray(candidate) || !Array.isArray(existing) || candidate.length !== existing.length) {
      return false
    }

    return candidate.every((item, index) => areSchemasEquivalentForReuse(
      item,
      existing[index],
      candidateRootSchema,
      existingRootSchema,
      candidateSchemas,
      existingSchemas,
      candidateToExistingComponentNames,
      existingToCandidateComponentNames,
      visited,
    ))
  }

  const candidateObject = candidate as Record<string, unknown>
  const existingObject = existing as Record<string, unknown>
  const candidateKeys = Object.keys(candidateObject).sort()
  const existingKeys = Object.keys(existingObject).sort()

  if (!isDeepEqual(candidateKeys, existingKeys)) {
    return false
  }

  return candidateKeys.every((key) => {
    const candidateValue = candidateObject[key]
    const existingValue = existingObject[key]

    if (key === '$ref' && typeof candidateValue === 'string' && typeof existingValue === 'string') {
      return areSchemaRefsEquivalentForReuse(
        candidateValue,
        existingValue,
        candidateRootSchema,
        existingRootSchema,
        candidateSchemas,
        existingSchemas,
        candidateToExistingComponentNames,
        existingToCandidateComponentNames,
        visited,
      )
    }

    return areSchemasEquivalentForReuse(
      candidateValue,
      existingValue,
      candidateRootSchema,
      existingRootSchema,
      candidateSchemas,
      existingSchemas,
      candidateToExistingComponentNames,
      existingToCandidateComponentNames,
      visited,
    )
  })
}

function parseComponentRefName(ref: string): string | undefined {
  if (!ref.startsWith('#/components/schemas/')) {
    return undefined
  }

  return ref
    .slice('#/components/schemas/'.length)
    .split('/')
    .map(decodeJsonPointerSegment)
    .join('/')
}

function resolveSchemaComparisonRef(
  ref: string,
  rootSchema: JsonSchema,
  componentsSchemas: Record<string, any>,
): { schema: JsonSchema, rootSchema: JsonSchema } | undefined {
  const localDefName = parseLocalDefRefName(ref)

  if (localDefName !== undefined && typeof rootSchema === 'object' && rootSchema !== null) {
    const localDef = rootSchema.$defs?.[localDefName]

    if (localDef !== undefined) {
      return {
        schema: localDef,
        rootSchema,
      }
    }
  }

  const componentName = parseComponentRefName(ref)

  if (componentName !== undefined) {
    const componentSchema = componentsSchemas[componentName]

    if (componentSchema !== undefined) {
      return {
        schema: componentSchema,
        rootSchema: componentSchema,
      }
    }
  }

  return undefined
}

function areSchemaRefsEquivalentForReuse(
  candidateRef: string,
  existingRef: string,
  candidateRootSchema: JsonSchema,
  existingRootSchema: JsonSchema,
  candidateSchemas: Record<string, JsonSchema>,
  existingSchemas: Record<string, any>,
  candidateToExistingComponentNames: Map<string, string>,
  existingToCandidateComponentNames: Map<string, string>,
  visited: WeakMap<object, WeakSet<object>>,
): boolean {
  const candidateComponentName = parseComponentRefName(candidateRef)
  const existingComponentName = parseComponentRefName(existingRef)

  if ((candidateComponentName === undefined) !== (existingComponentName === undefined)) {
    return false
  }

  if (candidateComponentName !== undefined && existingComponentName !== undefined) {
    const mappedExisting = candidateToExistingComponentNames.get(candidateComponentName)

    if (mappedExisting !== undefined && mappedExisting !== existingComponentName) {
      return false
    }

    const mappedCandidate = existingToCandidateComponentNames.get(existingComponentName)

    if (mappedCandidate !== undefined && mappedCandidate !== candidateComponentName) {
      return false
    }

    candidateToExistingComponentNames.set(candidateComponentName, existingComponentName)
    existingToCandidateComponentNames.set(existingComponentName, candidateComponentName)
  }

  const resolvedCandidate = resolveSchemaComparisonRef(candidateRef, candidateRootSchema, candidateSchemas)
  const resolvedExisting = resolveSchemaComparisonRef(existingRef, existingRootSchema, existingSchemas)

  if (resolvedCandidate === undefined || resolvedExisting === undefined) {
    return candidateRef === existingRef
  }

  return areSchemasEquivalentForReuse(
    resolvedCandidate.schema,
    resolvedExisting.schema,
    resolvedCandidate.rootSchema,
    resolvedExisting.rootSchema,
    candidateSchemas,
    existingSchemas,
    candidateToExistingComponentNames,
    existingToCandidateComponentNames,
    visited,
  )
}

function parseLocalDefRefName(ref: string): string | undefined {
  if (!ref.startsWith('#/$defs/')) {
    return undefined
  }

  return ref
    .slice('#/$defs/'.length)
    .split('/')
    .map(decodeJsonPointerSegment)
    .join('/')
}

function rewriteComponentSchemaRefs(schema: JsonSchema, renameMap: Record<string, string>): JsonSchema {
  return mapJsonSchemaRefs(schema, (ref) => {
    const refName = parseLocalDefRefName(ref)

    if (refName === undefined) {
      return ref
    }

    const renamedName = renameMap[refName]

    if (renamedName === undefined) {
      return ref
    }

    return `#/components/schemas/${encodeJsonPointerSegment(renamedName)}`
  })
}
