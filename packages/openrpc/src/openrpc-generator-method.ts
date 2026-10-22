import type { AnyProcedureContract, AnySchema, ErrorMap } from '@orpc/contract'
import type { JsonObjectSchemaEntry, JsonSchema, JsonSchemaConverter, JsonSchemaConverterDirection } from '@orpc/json-schema'
import type { OpenAPIComponentRegistry, OpenAPIJsonSerializer } from '@orpc/openapi'
import type { AnyProcedure } from '@orpc/server'
import type { Public } from '@orpc/shared'
import type { OpenRPCMeta, OpenRPCMethodExample } from './meta'
import type {
  OpenRPCContentDescriptorObject,
  OpenRPCErrorObject,
  OpenRPCExampleObject,
  OpenRPCExamplePairingObject,
  OpenRPCMethodObject,
} from './types'
import { ORPCError } from '@orpc/client'
import {
  combineJsonSchemasWithComposition,
  containsJsonFileSchema,
  decodeJsonPointerSegment,
  extractJsonObjectSchemaEntries,
  hoistRecursiveRefToDef,
  isUnconstrainedSchema,
  resolveJsonSchemaRootLocalRef,
  visitJsonSchemaRefs,
} from '@orpc/json-schema'
import { getOpenAPIMeta } from '@orpc/openapi'
import { getOwn, isPlainObject } from '@orpc/shared'
import { toJsonRpcErrorCode } from './json-rpc'
import { getOpenRPCMeta } from './meta'
import { isVoidLikeSchemas, JSON_RPC_METHOD_SEPARATOR } from './utils'

/**
 * Thrown by `OpenRPCGenerator` when procedures cannot be described as JSON-RPC methods,
 * such as procedures with File/Blob schemas or method names JSON-RPC cannot route.
 *
 * @see {@link https://orpc.dev/docs/openrpc/specification#openrpc-generator | OpenRPC Specification - OpenRPC Generator}
 */
export class OpenRPCGeneratorError extends TypeError {}

/**
 * Everything {@link buildMethod} needs from the surrounding `generate()` call.
 */
export interface OpenRPCMethodContext {
  converter: Pick<JsonSchemaConverter, 'convert'>
  registry: OpenAPIComponentRegistry
  serializer: Public<OpenAPIJsonSerializer>
  errorCodeMap: Record<string, number> | undefined
}

/**
 * The `name` of the single by-position param that carries a non-object input.
 */
const BY_POSITION_PARAM_NAME = 'input'

/**
 * The `name` of every method's result content descriptor.
 */
const RESULT_NAME = 'result'

const DEFS_REF_PREFIX = '#/$defs/'

/**
 * Root keywords an object schema may carry and still be split into by-name params without losing a constraint:
 * the object keywords the params express, plus annotations.
 */
const BY_NAME_ROOT_KEYWORDS = new Set([
  '$comment',
  '$defs',
  '$id',
  'additionalProperties',
  'default',
  'deprecated',
  'description',
  'examples',
  'properties',
  'readOnly',
  'required',
  'title',
  'type',
  'writeOnly',
])

/**
 * Builds the Method Object of a procedure: the generated one, replaced or transformed by the `spec` of its OpenRPC meta.
 *
 * Throws {@link OpenRPCGeneratorError} when the procedure cannot be described.
 */
export function buildMethod(
  ctx: OpenRPCMethodContext,
  contract: AnyProcedureContract | AnyProcedure,
  path: readonly string[],
): OpenRPCMethodObject {
  const meta = getOpenRPCMeta(contract)

  let method = meta?.spec !== undefined && typeof meta.spec !== 'function'
    ? meta.spec
    : generateMethod(ctx, contract, path, meta)

  if (typeof meta?.spec === 'function') {
    method = meta.spec(method)
  }

  return method
}

function generateMethod(
  ctx: OpenRPCMethodContext,
  contract: AnyProcedureContract | AnyProcedure,
  path: readonly string[],
  meta: OpenRPCMeta | undefined,
): OpenRPCMethodObject {
  const def = contract['~orpc']
  const openapiMeta = getOpenAPIMeta(contract)

  const [inputSchema, inputOptional] = convertSchemas(ctx.converter, def.inputSchemas, 'input')
  const [outputSchema, outputOptional] = convertSchemas(ctx.converter, def.outputSchemas, 'output')

  if (containsJsonFileSchema(inputSchema)) {
    throw new OpenRPCGeneratorError('the input schema contains a File/Blob schema, which JSON-RPC cannot carry.')
  }

  if (containsJsonFileSchema(outputSchema)) {
    throw new OpenRPCGeneratorError('the output schema contains a File/Blob schema, which JSON-RPC cannot carry.')
  }

  const { paramStructure, params } = buildParams(ctx, def.inputSchemas, inputSchema, inputOptional)
  const tags = meta?.tags ?? openapiMeta?.tags

  return omitUndefinedFields({
    name: path.join(JSON_RPC_METHOD_SEPARATOR),
    summary: meta?.summary ?? openapiMeta?.summary,
    description: meta?.description ?? openapiMeta?.description,
    tags: tags?.map(name => ({ name })),
    externalDocs: meta?.externalDocs,
    deprecated: meta?.deprecated ?? openapiMeta?.deprecated,
    paramStructure,
    params,
    result: buildResult(ctx, def.outputSchemas, outputSchema, outputOptional),
    errors: buildErrors(def.errorMap, ctx.errorCodeMap),
    examples: meta?.examples?.map(example => buildExample(ctx, example, paramStructure, params.length > 0)),
  })
}

/**
 * Converts a procedure's schemas into one JSON Schema and whether it accepts `undefined`.
 * No schema converts to `[{}, true]`, several schemas to the `allOf` of the constrained ones.
 */
export function convertSchemas(
  converter: Pick<JsonSchemaConverter, 'convert'>,
  schemas: readonly AnySchema[] | undefined,
  direction: JsonSchemaConverterDirection,
): [JsonSchema, boolean] {
  if (!schemas?.length) {
    return [{}, true]
  }

  const converted = schemas.map(schema => convertSchema(converter, schema, direction))

  if (converted.length === 1) {
    return converted[0]!
  }

  // an unconstrained schema adds nothing to `allOf`, such as one without JSON Schema support
  const constrained = converted.map(([jsonSchema]) => jsonSchema).filter(jsonSchema => !isUnconstrainedSchema(jsonSchema))

  return [
    combineJsonSchemasWithComposition('allOf', constrained),
    converted.every(([, optional]) => optional),
  ]
}

function convertSchema(
  converter: Pick<JsonSchemaConverter, 'convert'>,
  schema: AnySchema,
  direction: JsonSchemaConverterDirection,
): [JsonSchema, boolean] {
  const [jsonSchema, optional] = converter.convert(schema, direction)

  if (typeof jsonSchema !== 'object') {
    return [jsonSchema, optional]
  }

  const { $schema: _$schema, ...rest } = jsonSchema

  // composing or splitting would retarget root-relative refs (`#`, `#/properties/...`),
  // so move a schema that points into itself under a def first
  return [hoistRecursiveRefToDef(rest), optional]
}

/**
 * Maps the input to params, mirroring how the handler decodes them:
 *
 * - No input, or a void-like input such as `z.void()`: no params, any param structure.
 * - An object that splits losslessly: one by-name param per property, required ones first.
 *   An optional object qualifies only when all its properties are optional.
 * - Anything else: a single by-position `input` param.
 */
function buildParams(
  ctx: OpenRPCMethodContext,
  inputSchemas: readonly AnySchema[] | undefined,
  schema: JsonSchema,
  optional: boolean,
): Pick<OpenRPCMethodObject, 'paramStructure'> & { params: OpenRPCContentDescriptorObject[] } {
  if (!inputSchemas?.length || (isUnconstrainedSchema(schema) && isVoidLikeSchemas(inputSchemas, 'input'))) {
    return { params: [] }
  }

  const entries = toByNameEntries(schema)

  // an optional object splits only when every property is optional too, so no params can stand for `undefined`
  if (entries && (!optional || entries.every(([, , entryOptional]) => entryOptional))) {
    const required = entries.filter(([, , entryOptional]) => !entryOptional)
    const optionals = entries.filter(([, , entryOptional]) => entryOptional)

    return {
      paramStructure: 'by-name',
      params: [...required, ...optionals].map(([name, entrySchema, entryOptional]) => toContentDescriptor(
        name,
        entrySchema,
        ctx.registry.toOpenAPISchema(pruneUnreachableDefs(entrySchema), 'input') as JsonSchema,
        !entryOptional,
      )),
    }
  }

  return {
    paramStructure: 'by-position',
    params: [toContentDescriptor(
      BY_POSITION_PARAM_NAME,
      schema,
      ctx.registry.toOpenAPISchema(schema, 'input') as JsonSchema,
      !optional,
    )],
  }
}

/**
 * Splits an input schema into by-name param entries, or returns `undefined` when the split would lose a constraint.
 *
 * The root (after resolving a local `$ref`) must be a plain `type: 'object'` schema: only properties, `required`
 * properties that exist, annotations, and `additionalProperties` that are absent, `false`, or unconstrained.
 * Unions, nullable objects, records, and composed or pattern-constrained objects stay a single param.
 */
export function toByNameEntries(schema: JsonSchema): JsonObjectSchemaEntry[] | undefined {
  const root = resolveJsonSchemaRootLocalRef(schema)

  if (typeof root !== 'object' || root.type !== 'object') {
    return undefined
  }

  for (const key of Object.keys(root)) {
    if (root[key] !== undefined && !BY_NAME_ROOT_KEYWORDS.has(key) && !key.startsWith('x-')) {
      return undefined
    }
  }

  const { properties = {}, required = [], additionalProperties } = root

  if (additionalProperties !== undefined && additionalProperties !== false && !isUnconstrainedSchema(additionalProperties)) {
    return undefined
  }

  // a content descriptor name must not be empty
  if (!isPlainObject(properties) || Object.hasOwn(properties, '')) {
    return undefined
  }

  if (!Array.isArray(required) || required.some(name => typeof name !== 'string' || !Object.hasOwn(properties, name))) {
    return undefined
  }

  return extractJsonObjectSchemaEntries(schema)
}

/**
 * The result is always described, since `result` is mandatory on success: `undefined` is sent as `null`,
 * so a void-like output is `{ type: 'null' }` and an optional output also allows `null`.
 */
function buildResult(
  ctx: OpenRPCMethodContext,
  outputSchemas: readonly AnySchema[] | undefined,
  schema: JsonSchema,
  optional: boolean,
): OpenRPCContentDescriptorObject {
  // the JSON Schema must be unconstrained too: `z.string().optional()` also accepts `undefined` and rejects `{}`
  if (outputSchemas && isUnconstrainedSchema(schema) && isVoidLikeSchemas(outputSchemas, 'output')) {
    return { name: RESULT_NAME, schema: { type: 'null' } }
  }

  const jsonSchema = ctx.registry.toOpenAPISchema(schema, 'output') as JsonSchema

  return omitUndefinedFields({
    name: RESULT_NAME,
    description: getDescription(schema),
    schema: optional && !isUnconstrainedSchema(jsonSchema) ? { anyOf: [jsonSchema, { type: 'null' }] } : jsonSchema,
  })
}

/**
 * Builds a param content descriptor, lifting the `description` and `deprecated` annotations of the converted schema,
 * since draft-07 has no `deprecated` keyword.
 */
function toContentDescriptor(
  name: string,
  convertedSchema: JsonSchema,
  schema: JsonSchema,
  required: boolean,
): OpenRPCContentDescriptorObject {
  return omitUndefinedFields({
    name,
    description: getDescription(convertedSchema),
    required: required || undefined,
    deprecated: (typeof convertedSchema === 'object' && convertedSchema.deprecated === true) || undefined,
    schema,
  })
}

function getDescription(schema: JsonSchema): string | undefined {
  return typeof schema === 'object' && typeof schema.description === 'string' ? schema.description : undefined
}

/**
 * Describes the defined errors of a procedure. JSON-RPC requires unique codes per method, so errors
 * mapped to the same integer code share one entry, without `data` since the oRPC codes differ.
 */
function buildErrors(errorMap: ErrorMap, errorCodeMap: Record<string, number> | undefined): OpenRPCErrorObject[] | undefined {
  const groups = new Map<number, { code: string, message: string }[]>()

  for (const [code, config] of Object.entries(errorMap)) {
    if (config === undefined) {
      continue
    }

    const jsonRpcCode = toJsonRpcErrorCode(code, errorCodeMap)
    // the same default message the error is thrown with
    const message = new ORPCError(code, { message: config.message }).message
    const group = groups.get(jsonRpcCode)

    if (group) {
      group.push({ code, message })
    }
    else {
      groups.set(jsonRpcCode, [{ code, message }])
    }
  }

  if (groups.size === 0) {
    return undefined
  }

  return Array.from(groups, ([jsonRpcCode, group]): OpenRPCErrorObject => {
    if (group.length === 1) {
      const { code, message } = group[0]!
      return { code: jsonRpcCode, message, data: { code, defined: true } }
    }

    return { code: jsonRpcCode, message: group.map(({ code, message }) => `${message} (${code})`).join(' or ') }
  })
}

function buildExample(
  ctx: OpenRPCMethodContext,
  example: OpenRPCMethodExample,
  paramStructure: OpenRPCMethodObject['paramStructure'],
  hasParams: boolean,
): OpenRPCExamplePairingObject {
  return omitUndefinedFields({
    name: example.name,
    summary: example.summary,
    description: example.description,
    params: hasParams ? buildExampleParams(ctx, example, paramStructure) : [],
    result: Object.hasOwn(example, 'output')
      ? { name: RESULT_NAME, value: ctx.serializer.serializeJson(example.output).json }
      : undefined,
  })
}

function buildExampleParams(
  ctx: OpenRPCMethodContext,
  example: OpenRPCMethodExample,
  paramStructure: OpenRPCMethodObject['paramStructure'],
): OpenRPCExampleObject[] {
  if (paramStructure !== 'by-name') {
    return example.input === undefined
      ? []
      : [{ name: BY_POSITION_PARAM_NAME, value: ctx.serializer.serializeJson(example.input).json }]
  }

  const input = ctx.serializer.serializeJson(example.input).json ?? {}

  if (!isPlainObject(input)) {
    throw new OpenRPCGeneratorError(`the input of example "${example.name}" must be an object, since the method takes by-name params.`)
  }

  return Object.entries(input).map(([name, value]) => ({ name, value }))
}

/**
 * Sanitizes a component name to the characters OpenRPC allows in component keys (`^[A-Za-z0-9._-]+$`).
 */
export function toOpenRPCComponentName(name: string): string {
  return name.replace(/[^\w.-]/g, '_') || '_'
}

/**
 * Drops the root `$defs` the schema body cannot reach, such as the root defs every by-name entry carries,
 * so only the components a param uses get registered.
 */
export function pruneUnreachableDefs(schema: JsonSchema): JsonSchema {
  if (typeof schema !== 'object' || !schema.$defs) {
    return schema
  }

  const { $defs, ...body } = schema
  const reachable = new Set<string>()
  const pending: JsonSchema[] = [body]

  while (pending.length > 0) {
    visitJsonSchemaRefs(pending.pop()!, (ref) => {
      if (!ref.startsWith(DEFS_REF_PREFIX)) {
        return
      }

      const name = decodeJsonPointerSegment(ref.slice(DEFS_REF_PREFIX.length).split('/')[0]!)
      const def = getOwn($defs, name)

      if (def !== undefined && !reachable.has(name)) {
        reachable.add(name)
        pending.push(def)
      }
    })
  }

  if (reachable.size === 0) {
    return body
  }

  if (reachable.size === Object.keys($defs).length) {
    return schema
  }

  return { ...body, $defs: Object.fromEntries(Object.entries($defs).filter(([name]) => reachable.has(name))) }
}

/**
 * Drops `undefined` fields, so the document stays valid whatever the serializer does with them.
 */
function omitUndefinedFields<T extends object>(object: T): T {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)) as T
}
