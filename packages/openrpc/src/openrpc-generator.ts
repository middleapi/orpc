import type { AnyProcedureContract, AnySchema, RouterContract } from '@orpc/contract'
import type { JsonObjectSchemaEntry, JsonSchema, JsonSchemaConverter, JsonSchemaConverterDirection } from '@orpc/json-schema'
import type { AnyProcedure, AnyRouter } from '@orpc/server'
import type { Public, Value } from '@orpc/shared'
import type { OpenRPCMeta } from './meta'
import type { OpenRPCContentDescriptorObject, OpenRPCDocument, OpenRPCErrorObject, OpenRPCMethodObject } from './types'
import { ORPCError } from '@orpc/client'
import {
  combineJsonSchemasWithComposition,
  containsJsonFileSchema,
  DelegatingJsonSchemaConverter,
  extractJsonObjectSchemaEntries,
  hoistRecursiveRefToDef,
  isJsonObjectSchema,
  isUnconstrainedSchema,
  resolveJsonSchemaRootLocalRef,
  StandardJsonSchemaConverter,
} from '@orpc/json-schema'
import { getOpenAPIMeta, OpenAPIComponentRegistry, OpenAPIJsonSerializer } from '@orpc/openapi'
import { walkProcedureContractsAsync } from '@orpc/server'
import { clone, getOwn, toArray, value } from '@orpc/shared'
import { COMMON_JSON_RPC_ERROR_CODE_MAP, DEFAULT_JSON_RPC_ERROR_CODE } from './constants'
import { getOpenRPCMeta } from './meta'
import { isEventIteratorProcedure } from './utils'

export class OpenRPCGeneratorError extends TypeError {}

export interface OpenRPCGeneratorOptions {
  converters?: JsonSchemaConverter[] | undefined

  /**
   * The serializer used to serialize the generated document.
   */
  serializer?: Public<OpenAPIJsonSerializer> | undefined
}

export interface OpenRPCGeneratorGenerateOptions {
  /**
   * Document fields to start from, such as `info`, `servers`, or `components`.
   */
  base?: Partial<Omit<OpenRPCDocument, 'openrpc'>> | undefined

  /**
   * Filter procedures. Return `false` to exclude a procedure. Pass the same filter to `OpenRPCHandler`.
   *
   * @default true
   */
  filter?: Value<boolean, [contract: AnyProcedureContract | AnyProcedure, path: string[]]> | undefined

  /**
   * Mapping ORPCError Code -> JSON-RPC error code. Pass the same map to `OpenRPCHandler`.
   *
   * @default COMMON_JSON_RPC_ERROR_CODE_MAP
   */
  errorCodeMap?: Record<string, number> | undefined
}

/**
 * Root keywords of an object input that by-name params can express, so splitting it into one param per property loses nothing.
 */
const BY_NAME_ROOT_KEYWORDS = /* @__PURE__ */ new Set(['type', 'properties', 'required', 'additionalProperties', 'title', 'description', '$defs', '$comment', 'examples', 'default'])

/**
 * Generates an OpenRPC 1.3 document from a contract or router: each procedure becomes a method
 * named after its path joined by `.`, and procedures with event iterators are skipped.
 *
 * @see {@link https://orpc.dev/docs/openrpc/specification | OpenRPC Specification}
 */
export class OpenRPCGenerator {
  private readonly converter: DelegatingJsonSchemaConverter
  private readonly serializer: Public<OpenAPIJsonSerializer>

  constructor(options: OpenRPCGeneratorOptions = {}) {
    this.converter = new DelegatingJsonSchemaConverter([...toArray(options.converters), new StandardJsonSchemaConverter()])
    this.serializer = options.serializer ?? new OpenAPIJsonSerializer()
  }

  async generate(router: RouterContract | AnyRouter, options: OpenRPCGeneratorGenerateOptions = {}): Promise<OpenRPCDocument> {
    const base = clone(options.base) ?? {}
    const doc: OpenRPCDocument = {
      ...base,
      openrpc: '1.3.2',
      info: base.info ?? { title: 'API Reference', version: '0.0.0' },
      methods: base.methods ?? [],
    }

    // OpenRPC requires component names to match ^[a-zA-Z0-9.\-_]+$
    const registry = new OpenAPIComponentRegistry(doc, name => name.replace(/[^\w.-]/g, '_') || '_')
    const errors: string[] = []
    const errorCodeMap = options.errorCodeMap ?? COMMON_JSON_RPC_ERROR_CODE_MAP

    await walkProcedureContractsAsync(router, (contract, path) => {
      if (value(options.filter, contract, path) === false || isEventIteratorProcedure(contract)) {
        return
      }

      try {
        doc.methods.push(this.buildMethod(registry, contract, path, errorCodeMap))
      }
      catch (e) {
        if (!(e instanceof OpenRPCGeneratorError)) {
          throw e
        }

        errors.push(`Procedure at ${path.join('.') || '(root)'}: ${e.message}`)
      }
    })

    if (errors.length) {
      throw new OpenRPCGeneratorError(`[OpenRPCGenerator] Failed to generate the OpenRPC document:\n\n${errors.join('\n\n')}`)
    }

    return this.serializer.serializeJson(doc).json as OpenRPCDocument
  }

  private buildMethod(
    registry: OpenAPIComponentRegistry,
    contract: AnyProcedureContract,
    path: string[],
    errorCodeMap: Record<string, number>,
  ): OpenRPCMethodObject {
    const name = path.join('.')

    if (!path.length || path.some(key => key === '' || key.includes('.')) || name.startsWith('rpc.')) {
      throw new OpenRPCGeneratorError(
        `"${name}" is not a valid method name: router keys must be non-empty without ".", and names starting with "rpc." are reserved.`,
      )
    }

    const meta = getOpenRPCMeta(contract)
    const method = typeof meta?.spec === 'object' ? meta.spec : this.generateMethod(registry, contract, meta, name, errorCodeMap)

    return typeof meta?.spec === 'function' ? meta.spec(method) : method
  }

  private generateMethod(
    registry: OpenAPIComponentRegistry,
    contract: AnyProcedureContract,
    meta: OpenRPCMeta | undefined,
    name: string,
    errorCodeMap: Record<string, number>,
  ): OpenRPCMethodObject {
    const def = contract['~orpc']
    const [inputSchema, inputOptional] = this.convertSchemas(def.inputSchemas, 'input')
    const [outputSchema, outputOptional] = this.convertSchemas(def.outputSchemas, 'output')

    if (containsJsonFileSchema(inputSchema) || containsJsonFileSchema(outputSchema)) {
      throw new OpenRPCGeneratorError('File/Blob schemas cannot be sent over JSON-RPC.')
    }

    const openapiMeta = getOpenAPIMeta(contract)
    const resultSchema = registry.toOpenAPISchema(outputSchema, 'output')
    const method: OpenRPCMethodObject = {
      name,
      summary: meta?.summary ?? openapiMeta?.summary,
      description: meta?.description ?? openapiMeta?.description,
      deprecated: meta?.deprecated ?? openapiMeta?.deprecated,
      tags: (meta?.tags ?? openapiMeta?.tags)?.map(tag => ({ name: tag })),
      externalDocs: meta?.externalDocs,
      params: [],
      result: {
        name: 'result',
        // `undefined` is sent as `null`
        schema: outputOptional && !isUnconstrainedSchema(outputSchema) ? { anyOf: [resultSchema, { type: 'null' }] } : resultSchema,
      },
      errors: buildErrors(def.errorMap, errorCodeMap),
    }

    const entries = toByNameEntries(inputSchema)

    // an optional object can be sent by-name only when no param is required
    if (entries && (!inputOptional || entries.every(([, , optional]) => optional))) {
      method.paramStructure = 'by-name'
      method.params = entries
        .sort(([, , a], [, , b]) => Number(a) - Number(b))
        .map(([name, schema, optional]) => toContentDescriptor(registry, name, schema, optional))
    }
    // no input, or an input like `z.void()` or `z.any()`, needs no params
    else if (!isUnconstrainedSchema(inputSchema) || !inputOptional) {
      method.paramStructure = 'by-position'
      method.params = [toContentDescriptor(registry, 'input', inputSchema, inputOptional)]
    }

    // Example Objects require a `value`, so examples describe what is sent: undefined params are omitted, and an undefined result is `null`
    method.examples = meta?.examples?.map(example => ({
      name: example.name,
      summary: example.summary,
      description: example.description,
      params: method.paramStructure === 'by-name'
        ? Object.entries(example.input ?? {}).filter(([, value]) => value !== undefined).map(([name, value]) => ({ name, value }))
        : example.input === undefined ? [] : [{ name: 'input', value: example.input }],
      result: Object.hasOwn(example, 'output') ? { name: 'result', value: example.output ?? null } : undefined,
    }))

    return method
  }

  private convertSchemas(schemas: readonly AnySchema[] | undefined, direction: JsonSchemaConverterDirection): [JsonSchema, boolean] {
    const converted = (schemas ?? []).map((schema): [JsonSchema, boolean] => {
      const [jsonSchema, optional] = this.converter.convert(schema, direction)

      if (typeof jsonSchema !== 'object') {
        return [jsonSchema, optional]
      }

      const { $schema: _$schema, ...rest } = jsonSchema
      // composing would retarget root-relative refs, so move a schema that points into itself under a def first
      return [hoistRecursiveRefToDef(rest), optional]
    })

    if (converted.length <= 1) {
      return converted[0] ?? [{}, true]
    }

    return [
      combineJsonSchemasWithComposition('allOf', converted.map(([jsonSchema]) => jsonSchema).filter(s => !isUnconstrainedSchema(s))),
      converted.every(([, optional]) => optional),
    ]
  }
}

/**
 * The properties of an object input, or `undefined` when it is not a plain object schema.
 */
function toByNameEntries(schema: JsonSchema): JsonObjectSchemaEntry[] | undefined {
  const root = resolveJsonSchemaRootLocalRef(schema)

  if (
    !isJsonObjectSchema(root)
    || Object.keys(root).some(key => !BY_NAME_ROOT_KEYWORDS.has(key) && !key.startsWith('x-'))
    || !(root.additionalProperties === undefined || typeof root.additionalProperties === 'boolean' || isUnconstrainedSchema(root.additionalProperties))
    || Object.hasOwn(root.properties ?? {}, '')
  ) {
    return undefined
  }

  return extractJsonObjectSchemaEntries(schema)
}

function toContentDescriptor(registry: OpenAPIComponentRegistry, name: string, schema: JsonSchema, optional: boolean): OpenRPCContentDescriptorObject {
  return {
    name,
    description: typeof schema === 'object' ? schema.description : undefined,
    required: optional ? undefined : true,
    schema: registry.toOpenAPISchema(schema, 'input'),
  }
}

/**
 * OpenRPC requires unique error codes per method, so ORPCErrors mapped to the same code share an entry.
 */
function buildErrors(errorMap: AnyProcedureContract['~orpc']['errorMap'], errorCodeMap: Record<string, number>): OpenRPCErrorObject[] | undefined {
  const groups = new Map<number, { code: string, message: string }[]>()

  for (const code of Object.keys(errorMap)) {
    const config = errorMap[code]

    if (config) {
      const jsonRpcCode = getOwn(errorCodeMap, code) ?? DEFAULT_JSON_RPC_ERROR_CODE
      groups.set(jsonRpcCode, [...groups.get(jsonRpcCode) ?? [], { code, message: new ORPCError(code, { message: config.message }).message }])
    }
  }

  return groups.size === 0
    ? undefined
    : Array.from(groups, ([code, group]): OpenRPCErrorObject => group.length === 1
        ? { code, message: group[0]!.message, data: { code: group[0]!.code, defined: true } }
        : { code, message: group.map(error => `${error.message} (${error.code})`).join(' or ') })
}
