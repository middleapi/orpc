// eslint-disable-next-line no-restricted-imports
import type { OpenAPIV3_1 } from '@hey-api/spec-types'
import type { AnyProcedureContract, AnySchema } from '@orpc/contract'
import type { JsonObjectSchemaEntry, JsonSchema, JsonSchemaConverterDirection } from '@orpc/json-schema'
import type { Value } from '@orpc/shared'
import type { OpenAPIMeta } from './meta'
import type { OpenAPIComponentRegistry } from './openapi-generator-components'
import type { OpenAPIOperationObject } from './types'
import type { getDynamicPathParams } from './utils'
import { getAsyncIteratorObjectSchemaDetails } from '@orpc/contract'
import {
  combineJsonObjectSchemaEntries,
  combineJsonSchemasWithComposition,
  extractJsonObjectSchemaEntries,
  flattenJsonUnionSchema,
  isJsonFileSchema,
  isJsonPrimitiveSchema,
  isUnconstrainedSchema,
  matchArrayableJsonSchema,
} from '@orpc/json-schema'
import { DEFAULT_ERROR_STATUS, DEFAULT_SUCCESS_STATUS } from '@orpc/server'
import { findDeepMatches, isPlainObject, stringifyJSON, value } from '@orpc/shared'
import {
  DEFAULT_OPENAPI_INPUT_STRUCTURE,
  DEFAULT_OPENAPI_METHOD,
  DEFAULT_OPENAPI_OUTPUT_STRUCTURE,
  DEFAULT_OPENAPI_SUCCESS_DESCRIPTION,
} from './constants'

export type DynamicPathParam = NonNullable<ReturnType<typeof getDynamicPathParams>>[number]

export class OpenAPIGeneratorError extends TypeError { }

export interface OpenAPIErrorBodyDefinition {
  code: string
  defaultMessage: string | undefined
  dataOptional: boolean
  dataJsonSchema: JsonSchema
}

/**
 * Everything the operation builders need from the surrounding `generate()` call.
 */
export interface OpenAPIOperationContext {
  registry: OpenAPIComponentRegistry
  convertSchemas: (schemas: AnySchema[] | undefined, direction: JsonSchemaConverterDirection) => [JsonSchema, boolean]
  errorStatusMap: Record<string, number>
  customErrorResponseBodySchema: Value<
    JsonSchema | undefined | null,
    [definedErrors: OpenAPIErrorBodyDefinition[], status: number]
  > | undefined
}

export function toOpenAPIPath(path: `/${string}`, dynamicPathParams: DynamicPathParam[] | undefined): `/${string}` {
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

/**
 * The request pieces both input structures normalize into before rendering.
 */
interface RequestParts {
  paramsEntries: JsonObjectSchemaEntry[] | undefined
  queryEntries: JsonObjectSchemaEntry[] | undefined
  headersEntries: JsonObjectSchemaEntry[] | undefined
  bodySchema: JsonSchema | undefined
  bodyOptional: boolean | undefined
}

export function buildRequest(
  ctx: OpenAPIOperationContext,
  operation: OpenAPIOperationObject,
  def: AnyProcedureContract['~orpc'],
  meta: OpenAPIMeta | undefined,
  dynamicPathParams: DynamicPathParam[] | undefined,
): void {
  const method = meta?.method ?? DEFAULT_OPENAPI_METHOD
  const inputStructure = meta?.inputStructure ?? DEFAULT_OPENAPI_INPUT_STRUCTURE

  if (inputStructure === 'compact') {
    const iteratorDetails = getAsyncIteratorObjectDetails(def.inputSchemas)

    if (iteratorDetails) {
      operation.requestBody = {
        required: true,
        content: toAsyncIteratorObjectContent(
          ctx,
          ctx.convertSchemas(iteratorDetails[0], 'input'),
          ctx.convertSchemas(iteratorDetails[1], 'input'),
        ),
      }

      return
    }
  }

  const dynamicParams = dynamicPathParams?.map(v => v.parameterName)
  const [schema, optional] = ctx.convertSchemas(def.inputSchemas, 'input')

  if (isUnconstrainedSchema(schema) && !dynamicParams?.length) {
    return
  }

  const parts = inputStructure === 'compact'
    ? extractCompactRequestParts(schema, optional, method, dynamicParams)
    : extractDetailedRequestParts(schema)

  renderPathParameters(ctx, operation, dynamicParams, parts.paramsEntries, meta?.paramsStyles)
  renderQueryParameters(ctx, operation, parts.queryEntries, meta?.queryStyles)
  renderHeaderParameters(ctx, operation, parts.headersEntries)

  if (parts.bodySchema !== undefined) {
    operation.requestBody = {
      required: parts.bodyOptional ? undefined : true,
      content: toBodyContent(ctx, parts.bodySchema),
    }
  }
}

function extractCompactRequestParts(
  schema: JsonSchema,
  optional: boolean,
  method: NonNullable<OpenAPIMeta['method']>,
  dynamicParams: string[] | undefined,
): RequestParts {
  const entries = extractJsonObjectSchemaEntries(schema)

  if (!entries && method === 'GET') {
    throw new OpenAPIGeneratorError(
      `method is GET but the input schema is not an object.\n`
      + `  GET sends every input field as a query parameter, so the input must be an object schema.\n`
      + `  Fix: make the input an object, or use a method with a request body (POST, PUT, PATCH, DELETE).`,
    )
  }

  const paramsEntries = entries?.filter(([name]) => dynamicParams?.includes(name))
  const restEntries = entries?.filter(([name]) => !dynamicParams?.includes(name))

  const hasBody = method !== 'GET' && method !== 'HEAD'
  const bodySchema = !hasBody
    ? undefined
    : !dynamicParams?.length
        ? schema
        : restEntries
          ? combineJsonObjectSchemaEntries(restEntries)
          : undefined

  return {
    paramsEntries,
    queryEntries: method === 'GET' ? restEntries : undefined,
    headersEntries: undefined,
    bodySchema,
    bodyOptional: !dynamicParams?.length ? optional : restEntries?.every(([,,optional]) => optional),
  }
}

function extractDetailedRequestParts(schema: JsonSchema): RequestParts {
  const entries = extractJsonObjectSchemaEntries(schema)

  if (!entries) {
    throw new OpenAPIGeneratorError(
      `inputStructure is "detailed" but the input schema is not an object.\n`
      + `  Expected an object shaped like: { params?: object, query?: object, headers?: object, body?: unknown }`,
    )
  }

  const section = (name: string) => entries.find(([entryName]) => entryName === name)

  return {
    paramsEntries: extractJsonObjectSchemaEntries(section('params')?.[1] ?? false),
    queryEntries: extractJsonObjectSchemaEntries(section('query')?.[1] ?? false),
    headersEntries: extractJsonObjectSchemaEntries(section('headers')?.[1] ?? false),
    bodySchema: section('body')?.[1],
    bodyOptional: section('body')?.[2],
  }
}

function renderPathParameters(
  ctx: OpenAPIOperationContext,
  operation: OpenAPIOperationObject,
  dynamicParams: string[] | undefined,
  paramsEntries: JsonObjectSchemaEntry[] | undefined,
  paramsStyles: OpenAPIMeta['paramsStyles'],
): void {
  if (!dynamicParams?.length) {
    return
  }

  if (!paramsEntries) {
    throw new OpenAPIGeneratorError(
      `the route declares path params (${dynamicParams.map(p => `{${p}}`).join(', ')}) but there is no object schema to source them from.\n`
      + `  compact mode:  the input schema must be an object containing each param.\n`
      + `  detailed mode: the input's "params" section must be an object containing each param.`,
    )
  }

  for (const name of dynamicParams) {
    const entry = paramsEntries.find(([entryName]) => entryName === name)

    if (!entry) {
      throw new OpenAPIGeneratorError(
        `dynamic param "{${name}}" is missing from the input schema.\n`
        + `  Route params: ${dynamicParams.map(p => `{${p}}`).join(', ')}\n`
        + `  Schema keys:  ${paramsEntries.map(([n]) => n).join(', ') || '(none)'}`,
      )
    }

    if (entry[2]) {
      throw new OpenAPIGeneratorError(
        `dynamic param "${name}" is optional in the input schema.\n`
        + `  OpenAPI requires path params to be required. Make "${name}" required.`,
      )
    }

    const style = paramsStyles?.[name]
    const parameter: Exclude<OpenAPIOperationObject['parameters'], undefined>[number] = {
      in: 'path',
      required: true,
      name,
      schema: ctx.registry.toOpenAPISchema(entry[1]),
    }

    if (style === 'comma-delimited-array' || style === 'comma-delimited-object') {
      parameter.style = 'simple'
      parameter.explode = false
    }
    else {
      const _expect: 'primitive' | undefined = style
    }

    operation.parameters ??= []
    operation.parameters.push(parameter)
  }
}

function renderQueryParameters(
  ctx: OpenAPIOperationContext,
  operation: OpenAPIOperationObject,
  queryEntries: JsonObjectSchemaEntry[] | undefined,
  queryStyles: OpenAPIMeta['queryStyles'],
): void {
  for (const [name, schema, optional] of queryEntries ?? []) {
    const style = queryStyles?.[name]
    const parameter: Exclude<OpenAPIOperationObject['parameters'], undefined>[number] = {
      in: 'query',
      name,
      schema: ctx.registry.toOpenAPISchema(schema),
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

    operation.parameters ??= []
    operation.parameters.push(parameter)
  }
}

function renderHeaderParameters(
  ctx: OpenAPIOperationContext,
  operation: OpenAPIOperationObject,
  headersEntries: JsonObjectSchemaEntry[] | undefined,
): void {
  for (const [name, schema, optional] of headersEntries ?? []) {
    operation.parameters ??= []
    operation.parameters.push({
      in: 'header',
      name,
      required: optional ? undefined : true,
      schema: ctx.registry.toOpenAPISchema(schema),
    })
  }
}

export function buildSuccessResponse(
  ctx: OpenAPIOperationContext,
  operation: OpenAPIOperationObject,
  def: AnyProcedureContract['~orpc'],
  meta: OpenAPIMeta | undefined,
): void {
  const status = meta?.successStatus ?? DEFAULT_SUCCESS_STATUS
  const description = meta?.successDescription ?? DEFAULT_OPENAPI_SUCCESS_DESCRIPTION
  const outputStructure = meta?.outputStructure ?? DEFAULT_OPENAPI_OUTPUT_STRUCTURE

  if (outputStructure === 'compact') {
    const iteratorDetails = getAsyncIteratorObjectDetails(def.outputSchemas)

    if (iteratorDetails) {
      operation.responses ??= {}
      operation.responses[status] = {
        description,
        content: toAsyncIteratorObjectContent(
          ctx,
          ctx.convertSchemas(iteratorDetails[0], 'output'),
          ctx.convertSchemas(iteratorDetails[1], 'output'),
        ),
      }

      return
    }
  }

  const [schema] = ctx.convertSchemas(def.outputSchemas, 'output')

  if (isUnconstrainedSchema(schema) || outputStructure === 'compact') {
    operation.responses ??= {}
    operation.responses[status] = {
      description,
      content: toBodyContent(ctx, schema),
    }
    return
  }

  for (const [responseStatus, parts] of extractDetailedResponseParts(schema, status)) {
    const responseObject: OpenAPIV3_1.ResponseObject = {
      description: parts.descriptions.length ? parts.descriptions.join(', ') : description,
    }

    if (parts.bodies.length) {
      responseObject.content = toBodyContent(ctx, combineJsonSchemasWithComposition('anyOf', parts.bodies))
    }

    if (parts.headers.length) {
      const entries = extractJsonObjectSchemaEntries(combineJsonSchemasWithComposition('anyOf', parts.headers))
      entries?.forEach(([name, schema, optional]) => {
        responseObject.headers ??= {}
        responseObject.headers[name] = {
          required: optional ? undefined : true,
          schema: ctx.registry.toOpenAPISchema(schema),
        }
      })
    }

    operation.responses ??= {}
    operation.responses[responseStatus] = responseObject
  }
}

/**
 * Flattens a detailed output schema (a union of `{ status?, headers?, body? }` objects)
 * into per-status response pieces.
 */
function extractDetailedResponseParts(
  schema: JsonSchema,
  defaultStatus: number,
): Map<number, { descriptions: string[], bodies: JsonSchema[], headers: JsonSchema[] }> {
  const partsByStatus = new Map<number, { descriptions: string[], bodies: JsonSchema[], headers: JsonSchema[] }>()

  for (const item of flattenJsonUnionSchema(schema)) {
    const entries = extractJsonObjectSchemaEntries(item)

    if (!entries) {
      throw new OpenAPIGeneratorError(
        `outputStructure is "detailed" but the output schema (or one of its union members) is not an object.\n`
        + `  Expected each member shaped like: { status?: number (< 400), headers?: object, body?: unknown }`,
      )
    }

    const statusSchema = entries.find(([name]) => name === 'status')?.[1]

    if (statusSchema !== undefined && (typeof statusSchema !== 'object' || !Number.isInteger(statusSchema.const) || statusSchema.const >= 400)) {
      throw new OpenAPIGeneratorError(
        `invalid "status" field in the detailed output schema.\n`
        + `  Expected: a literal (const) integer below 400\n`
        + `  Received: ${stringifyJSON(statusSchema)}`,
      )
    }

    const status = (statusSchema?.const as number || undefined) ?? defaultStatus

    let parts = partsByStatus.get(status)
    if (!parts) {
      parts = { descriptions: [], bodies: [], headers: [] }
      partsByStatus.set(status, parts)
    }

    if (statusSchema?.description !== undefined) {
      parts.descriptions.push(statusSchema.description)
    }

    const headersSchema = entries.find(([name]) => name === 'headers')?.[1]
    if (headersSchema !== undefined) {
      parts.headers.push(headersSchema)
    }

    const bodySchema = entries.find(([name]) => name === 'body')?.[1]
    if (bodySchema !== undefined) {
      parts.bodies.push(bodySchema)
    }
  }

  return partsByStatus
}

export function buildErrorResponse(
  ctx: OpenAPIOperationContext,
  operation: OpenAPIOperationObject,
  def: AnyProcedureContract['~orpc'],
): void {
  const definitionsByStatus = new Map<number, OpenAPIErrorBodyDefinition[]>()

  for (const code in def.errorMap) {
    const config = def.errorMap[code]
    if (!config) {
      continue
    }

    const status = ctx.errorStatusMap[code] ?? DEFAULT_ERROR_STATUS
    const [dataJsonSchema, dataOptional] = ctx.convertSchemas(config.data !== undefined ? [config.data] : undefined, 'output')

    let definitions = definitionsByStatus.get(status)
    if (!definitions) {
      definitions = []
      definitionsByStatus.set(status, definitions)
    }

    definitions.push({ code, dataJsonSchema, dataOptional, defaultMessage: config.message })
  }

  if (!definitionsByStatus.size) {
    return
  }

  const undefinedErrorSchema = ctx.registry.register('UndefinedError', {
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
  })

  for (const [status, definitions] of definitionsByStatus.entries()) {
    const descriptions = definitions.map(({ defaultMessage }) => defaultMessage).filter(m => m !== undefined)
    const customBodySchema = value(
      ctx.customErrorResponseBodySchema,
      definitions.map(def => ({ ...def, dataJsonSchema: ctx.registry.hoistDefs(def.dataJsonSchema) })),
      status,
    )
    const responseSchema = customBodySchema ?? combineJsonSchemasWithComposition('oneOf', [
      ...definitions.map(({ code, dataJsonSchema, dataOptional, defaultMessage }) => {
        return ctx.registry.register(toErrorComponentName(code), combineJsonObjectSchemaEntries([
          ['defined', { const: true }, false],
          ['inferable', { type: 'boolean' }, false],
          ['code', { const: code }, false],
          ['status', { const: status }, false],
          ['message', { type: 'string', default: defaultMessage }, false],
          ['data', ctx.registry.hoistDefs(dataJsonSchema), dataOptional],
        ]))
      }),
      undefinedErrorSchema,
    ])

    operation.responses ??= {}
    operation.responses[status] = {
      description: descriptions.length ? descriptions.join(', ') : status.toString(),
      content: {
        'application/json': {
          schema: ctx.registry.toOpenAPISchema(responseSchema),
        },
      },
    } satisfies OpenAPIV3_1.ResponseObject
  }
}

/**
 * Converts an error code into a component name, e.g. `BAD_REQUEST` -> `BadRequest`.
 */
function toErrorComponentName(code: string): string {
  const name = code
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => {
      const rest = part.slice(1)
      return part.charAt(0).toUpperCase() + (rest === rest.toUpperCase() ? rest.toLowerCase() : rest)
    })
    .join('')

  return name || 'Error'
}

function getAsyncIteratorObjectDetails(schemas: AnySchema[] | undefined): [yieldSchemas: AnySchema[], returnSchemas: AnySchema[]] | undefined {
  if (!schemas || schemas.length === 0) {
    return undefined
  }

  const yieldSchemas: AnySchema[] = []
  const returnSchemas: AnySchema[] = []

  for (const s of schemas) {
    const details = getAsyncIteratorObjectSchemaDetails(s)
    if (!details) {
      return undefined
    }

    yieldSchemas.push(details.yieldSchema)
    if (details.returnSchema) {
      returnSchemas.push(details.returnSchema)
    }
  }

  return [yieldSchemas, returnSchemas]
}

function toAsyncIteratorObjectContent(
  ctx: OpenAPIOperationContext,
  [yieldSchema, yieldOptional]: [JsonSchema, optional: boolean],
  [returnSchema, returnOptional]: [JsonSchema, optional: boolean],
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
      schema: ctx.registry.toOpenAPISchema(schema),
    },
  }
}

function toBodyContent(ctx: OpenAPIOperationContext, schema: JsonSchema): Record<string, OpenAPIV3_1.MediaTypeObject> {
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
      schema: ctx.registry.toOpenAPISchema(combineJsonSchemasWithComposition('anyOf', [restSchema, ...fileSchemas ?? []])),
    }
  }

  for (const [contentType, schemas] of fileSchemasByMediaType.entries()) {
    content[contentType] = {
      schema: ctx.registry.toOpenAPISchema(combineJsonSchemasWithComposition('anyOf', schemas)),
    }
  }

  return content
}
