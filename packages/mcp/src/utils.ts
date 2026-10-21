import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import type { AnySchema } from '@orpc/contract'
import type { JsonSchema, JsonSchemaConverter } from '@orpc/json-schema'
import { getAsyncIteratorObjectSchemasDetails } from '@orpc/contract'
import { combineJsonSchemasWithComposition, ensureJsonSchemaObject, flattenJsonUnionSchema, hoistRecursiveRefToDef, isJsonFileSchema, isJsonObjectLikeSchema, isStandardSchemaOptional, isUnconstrainedSchema } from '@orpc/json-schema'
import { isTypescriptObject, ORPC_NAME } from '@orpc/shared'

type JsonSchemaObject = Exclude<JsonSchema, boolean>

/**
 * The key a non-object input is nested under, since MCP tool arguments must be an object.
 */
const WRAPPED_INPUT_KEY = 'input'

export interface ToolInputJsonSchema {
  /**
   * The advertised JSON Schema, which always accepts only objects.
   */
  jsonSchema: JsonSchemaObject

  /**
   * Whether the input is nested under {@link WRAPPED_INPUT_KEY}.
   */
  wrapped: boolean

  /**
   * Whether empty arguments mean no input, for inputs like `z.void()` that accept `undefined` but reject `{}`.
   */
  emptyAsUndefined: boolean
}

/**
 * Whether a schema synchronously rejects an empty object, or `false` when it validates asynchronously or throws.
 */
function rejectsEmptyObject(schema: AnySchema): boolean {
  try {
    const result = schema['~standard'].validate({})

    if (result instanceof Promise) {
      result.catch(() => {})
      return false
    }

    return result.issues !== undefined
  }
  catch {
    return false
  }
}

/**
 * Probes the schemas themselves, since a JSON Schema cannot tell `z.void()` from a schema the converters do not support.
 */
function isEmptyAsUndefined(inputSchemas: AnySchema[]): boolean {
  return inputSchemas.every(schema => isStandardSchemaOptional(schema, 'input')) && inputSchemas.some(rejectsEmptyObject)
}

function convertSchema(
  converter: Pick<JsonSchemaConverter, 'convert'>,
  schema: AnySchema,
  direction: 'input' | 'output',
): [JsonSchema, boolean] {
  const [jsonSchema, optional] = converter.convert(schema, direction)

  if (typeof jsonSchema !== 'object') {
    return [jsonSchema, optional]
  }

  const { $schema: _$schema, ...rest } = jsonSchema

  // nesting or composing would retarget root-relative refs (`#`, `#/properties/...`),
  // so move a schema that points into itself under a def first
  return [hoistRecursiveRefToDef(rest), optional]
}

function combineConvertedSchemas(converted: [JsonSchema, boolean][]): [JsonSchema, boolean] {
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

/**
 * Resolves the JSON Schema advertised as a tool's `inputSchema`.
 *
 * MCP tool arguments must be an object, so an input that may not be an object
 * is nested under {@link WRAPPED_INPUT_KEY}.
 */
export function resolveToolInputJsonSchema(
  converter: Pick<JsonSchemaConverter, 'convert'>,
  inputSchemas: AnySchema[],
): ToolInputJsonSchema {
  if (inputSchemas.length === 0) {
    return { jsonSchema: { type: 'object', properties: {} }, wrapped: false, emptyAsUndefined: false }
  }

  const converted = inputSchemas.map(schema => convertSchema(converter, schema, 'input'))
  const [combined, optional] = combineConvertedSchemas(converted)
  const jsonSchema = ensureJsonSchemaObject(combined)

  // the MCP SDK types untyped roots as `object`
  if (isJsonObjectLikeSchema(jsonSchema)) {
    return { jsonSchema, wrapped: false, emptyAsUndefined: isEmptyAsUndefined(inputSchemas) }
  }

  const { $defs, ...body } = jsonSchema

  return {
    jsonSchema: {
      type: 'object',
      properties: { [WRAPPED_INPUT_KEY]: body },
      ...(optional ? {} : { required: [WRAPPED_INPUT_KEY] }),
      ...($defs ? { $defs } : {}),
    },
    wrapped: true,
    emptyAsUndefined: false,
  }
}

/**
 * Unwraps tool arguments into the procedure input.
 * Empty arguments become `undefined` for inputs that accept no object.
 */
export function resolveToolInput(args: unknown, inputJsonSchema: ToolInputJsonSchema): unknown {
  if (inputJsonSchema.emptyAsUndefined && isTypescriptObject(args) && Object.keys(args).length === 0) {
    return undefined
  }

  return inputJsonSchema.wrapped && isTypescriptObject(args)
    ? args[WRAPPED_INPUT_KEY]
    : args
}

/**
 * Resolves the JSON Schema advertised as a tool's `outputSchema`,
 * or `undefined` when the output may be undefined, unconstrained, or binary.
 *
 * Every output schema must describe an [AsyncIteratorObject](https://orpc.dev/docs/async-iterator-object)
 * for the yield schemas to be used, since tools return the last yielded value.
 */
export function resolveToolOutputJsonSchema(
  converter: Pick<JsonSchemaConverter, 'convert'>,
  outputSchemas: AnySchema[],
): JsonSchemaObject | undefined {
  if (outputSchemas.length === 0) {
    return undefined
  }

  const yieldSchemas = getAsyncIteratorObjectSchemasDetails(outputSchemas)?.yieldSchemas
  const converted = (yieldSchemas ?? outputSchemas).map(schema => convertSchema(converter, schema, 'output'))
  const [combined, optional] = combineConvertedSchemas(converted)

  // an output schema requires structured content in every result, which undefined, binary, or unknown outputs cannot provide
  if (optional || isUnconstrainedSchema(combined) || flattenJsonUnionSchema(combined).some(isJsonFileSchema)) {
    return undefined
  }

  return ensureJsonSchemaObject(combined)
}

const passthroughValidate = (value: unknown) => ({ value })

/**
 * A Standard Schema the MCP SDK reads the JSON Schema from, with validation left to oRPC,
 * so procedures validate input and output exactly as they do behind any handler.
 */
export function toPassthroughStandardSchema(jsonSchema: JsonSchemaObject): StandardSchemaWithJSON {
  const getJsonSchema = () => jsonSchema as Record<string, unknown>

  return {
    '~standard': {
      vendor: ORPC_NAME,
      version: 1,
      validate: passthroughValidate,
      jsonSchema: { input: getJsonSchema, output: getJsonSchema },
    },
  }
}
