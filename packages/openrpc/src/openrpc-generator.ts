import type { AnyProcedureContract, RouterContract } from '@orpc/contract'
import type { JsonSchema, JsonSchemaConverter } from '@orpc/json-schema'
import type { AnyProcedure, AnyRouter } from '@orpc/server'
import type { Public, Value } from '@orpc/shared'
import type { OpenRPCMethodContext } from './openrpc-generator-method'
import type { OpenRPCContentDescriptorObject, OpenRPCDocument, OpenRPCMethodObject, OpenRPCReferenceObject } from './types'
import { DelegatingJsonSchemaConverter, StandardJsonSchemaConverter } from '@orpc/json-schema'
import { OpenAPIComponentRegistry, OpenAPIJsonSerializer } from '@orpc/openapi'
import { walkProcedureContractsAsync } from '@orpc/server'
import { clone, isPlainObject, setOwn, toArray, value } from '@orpc/shared'
import { DEFAULT_OPENRPC_VERSION } from './constants'
import { toDraft07JsonSchema } from './json-schema-draft-07'
import { buildMethod, OpenRPCGeneratorError, toOpenRPCComponentName } from './openrpc-generator-method'
import { assertJsonRpcErrorCodeMap, isEventIteratorProcedure, JSON_RPC_METHOD_SEPARATOR, RESERVED_JSON_RPC_METHOD_PREFIX } from './utils'

export { OpenRPCGeneratorError } from './openrpc-generator-method'

/**
 * OpenRPC versions `OpenRPCGenerator` can target. Both share one document structure.
 *
 * @see {@link https://orpc.dev/docs/openrpc/specification#openrpc-version | OpenRPC Specification - OpenRPC Version}
 */
export type OpenRPCVersion = `1.3.${number}` | `1.4.${number}`

export interface OpenRPCGeneratorOptions {
  /**
   * Converters that translate input and output schemas into JSON Schemas.
   * Schemas implementing [Standard JSON Schema](https://standardschema.dev/json-schema) need no converter.
   *
   * @see {@link https://orpc.dev/docs/openrpc/specification#json-schema-converters | OpenRPC Specification - Json Schema Converters}
   */
  converters?: JsonSchemaConverter[] | undefined

  /**
   * The serializer used to serialize the generated OpenRPC document and example values.
   *
   * @default new OpenAPIJsonSerializer()
   */
  serializer?: Public<OpenAPIJsonSerializer> | undefined
}

export interface OpenRPCGeneratorGenerateOptions {
  /**
   * The OpenRPC version of the generated document. 1.3 and 1.4 documents share one structure,
   * but some tools, such as `@open-rpc/generator`, only accept 1.3.
   *
   * @default DEFAULT_OPENRPC_VERSION ('1.3.2')
   * @see {@link https://orpc.dev/docs/openrpc/specification#openrpc-version | OpenRPC Specification - OpenRPC Version}
   */
  version?: OpenRPCVersion | undefined

  /**
   * OpenRPC document fields to start from, such as `info`, `servers`, or `components`.
   * The `openrpc` field is derived from `version`.
   *
   * @remarks
   * - `base.methods` come first, before the generated methods.
   * - `base.components.schemas` are kept as they are, so write them as JSON Schema draft-07.
   * - Use absolute `servers[].url` values, the meta-schema validates them as URIs.
   *
   * @default { info: { title: 'API Reference', version: '0.0.0' } }
   */
  base?: Partial<Omit<OpenRPCDocument, 'openrpc'>> | undefined

  /**
   * Filter procedures. Return `false` to exclude a procedure from the OpenRPC document.
   * Procedures with event iterator inputs or outputs are always excluded, as JSON-RPC cannot carry them.
   *
   * @remarks
   * **Note**: Pass the same function as the `filter` of `OpenRPCHandler`, so the document lists exactly the methods it serves.
   *
   * @default true
   * @see {@link https://orpc.dev/docs/openrpc/specification#filtering-procedures | OpenRPC Specification - Filtering Procedures}
   */
  filter?: Value<boolean, [contract: AnyProcedureContract | AnyProcedure, path: string[]]> | undefined

  /**
   * Mapping ORPCError Code -> JSON-RPC Error Code, used for the `errors` of each method.
   * A given map replaces (does not extend) the default, codes missing from it fall back to
   * `DEFAULT_JSON_RPC_ERROR_CODE` (-32000).
   *
   * @remarks
   * **Note**: Pass the same map as the `errorCodeMap` of `OpenRPCHandler`.
   *
   * @default COMMON_JSON_RPC_ERROR_CODE_MAP
   * @see {@link https://orpc.dev/docs/openrpc/specification#errors | OpenRPC Specification - Errors}
   */
  errorCodeMap?: Record<string, number> | undefined

  /**
   * Root-level `$defs` are always moved into `components.schemas`.
   * Use this to customize the component name of a hoisted def.
   *
   * @remarks
   * - The returned name is a preference, conflicting names are still postfixed (`Planet`, `PlanetInput`, `Planet2`, ...).
   * - Return `undefined` to keep the original def name.
   * - Characters OpenRPC does not allow in component keys (anything but `A-Z`, `a-z`, `0-9`, `.`, `_`, and `-`) are replaced with `_`.
   *
   * @default defName => defName
   * @see {@link https://orpc.dev/docs/openrpc/specification#hoisting-defs | OpenRPC Specification - Hoisting $defs}
   */
  customComponentName?: ((defName: string, defSchema: JsonSchema) => string | undefined) | undefined
}

/**
 * Generates an OpenRPC document from a contract or router, describing every procedure as the JSON-RPC method
 * `OpenRPCHandler` serves it as. Relies on JSON schema converters to translate input and output schemas into JSON Schemas,
 * which are lowered to the JSON Schema draft-07 that OpenRPC uses.
 *
 * @see {@link https://orpc.dev/docs/openrpc/specification#openrpc-generator | OpenRPC Specification - OpenRPC Generator}
 */
export class OpenRPCGenerator {
  private readonly serializer: Public<OpenAPIJsonSerializer>
  private readonly converter: Pick<JsonSchemaConverter, 'convert'>

  constructor(options: OpenRPCGeneratorOptions = {}) {
    this.serializer = options.serializer ?? new OpenAPIJsonSerializer()
    this.converter = new DelegatingJsonSchemaConverter([
      ...toArray(options.converters),
      new StandardJsonSchemaConverter(),
    ])
  }

  /**
   * Throws an {@link OpenRPCGeneratorError} listing every procedure that cannot be described,
   * such as procedures with File/Blob schemas or method names JSON-RPC cannot route.
   */
  async generate(
    router: RouterContract | AnyRouter,
    options: OpenRPCGeneratorGenerateOptions = {},
  ): Promise<OpenRPCDocument> {
    assertJsonRpcErrorCodeMap(options.errorCodeMap, 'OpenRPCGenerator')

    const { openrpc: _openrpc, info, methods, ...base } = (clone(options.base) ?? {}) as Partial<OpenRPCDocument>

    const doc: OpenRPCDocument = {
      openrpc: options.version ?? DEFAULT_OPENRPC_VERSION,
      info: info ?? { title: 'API Reference', version: '0.0.0' },
      ...base,
      methods: methods ?? [],
    }

    const baseMethodCount = doc.methods.length
    const baseSchemaNames = new Set(Object.keys(doc.components?.schemas ?? {}))
    const customComponentName = options.customComponentName

    const ctx: OpenRPCMethodContext = {
      converter: this.converter,
      registry: new OpenAPIComponentRegistry(
        doc,
        (defName, defSchema) => toOpenRPCComponentName(customComponentName?.(defName, defSchema) ?? defName),
      ),
      serializer: this.serializer,
      errorCodeMap: options.errorCodeMap,
    }

    const methodNames = new Set(doc.methods.flatMap(method => 'name' in method ? [method.name] : []))
    const errors: string[] = []

    await walkProcedureContractsAsync(router, (contract, path) => {
      // same exclusions as the handler, which answers "Method not found" for these procedures
      if (value(options.filter, contract, path) === false || isEventIteratorProcedure(contract)) {
        return
      }

      try {
        assertRoutableMethodPath(path)

        const method = buildMethod(ctx, contract, path)

        if (methodNames.has(method.name)) {
          throw new OpenRPCGeneratorError(`duplicate method name "${method.name}".`)
        }

        methodNames.add(method.name)
        doc.methods.push(method)
      }
      catch (e) {
        if (!(e instanceof OpenRPCGeneratorError)) {
          throw e
        }

        errors.push(`Procedure at ${path.join('.') || '(root)'}: ${e.message}`)
      }
    })

    if (errors.length) {
      throw new OpenRPCGeneratorError(
        `[OpenRPCGenerator] Failed to generate the OpenRPC document (${errors.length} error${errors.length === 1 ? '' : 's'}):\n\n`
        + `${errors.join('\n\n')}\n\n`
        + `Exclude procedures with the "filter" option (use the same filter on OpenRPCHandler).`,
      )
    }

    // components are lowered only now: while generating, they are compared against new defs in their converted form
    doc.methods = doc.methods.map((method, index) => index < baseMethodCount ? method : toDraft07Method(method))

    const schemas = doc.components?.schemas

    if (schemas) {
      for (const name of Object.keys(schemas)) {
        if (!baseSchemaNames.has(name)) {
          setOwn(schemas, name, toDraft07JsonSchema(schemas[name]!))
        }
      }
    }

    return this.serializer.serializeJson(doc).json as OpenRPCDocument
  }
}

/**
 * Throws when JSON-RPC calls to the method named after `path` could not reach the procedure.
 */
function assertRoutableMethodPath(path: readonly string[]): void {
  if (path.length === 0) {
    throw new OpenRPCGeneratorError('the root procedure has no method name, nest it in a router.')
  }

  const invalidKey = path.find(key => key === '' || key.includes(JSON_RPC_METHOD_SEPARATOR))

  if (invalidKey !== undefined) {
    throw new OpenRPCGeneratorError(
      `the router key "${invalidKey}" ${invalidKey === '' ? 'is empty' : `contains "${JSON_RPC_METHOD_SEPARATOR}"`}, `
      + `so calls to the method "${path.join(JSON_RPC_METHOD_SEPARATOR)}" cannot reach this procedure.`,
    )
  }

  if (path.join(JSON_RPC_METHOD_SEPARATOR).startsWith(RESERVED_JSON_RPC_METHOD_PREFIX)) {
    throw new OpenRPCGeneratorError(`method names starting with "${RESERVED_JSON_RPC_METHOD_PREFIX}" are reserved by JSON-RPC.`)
  }
}

function toDraft07Method(method: OpenRPCMethodObject | OpenRPCReferenceObject): OpenRPCMethodObject | OpenRPCReferenceObject {
  if (!('name' in method)) {
    return method
  }

  return {
    ...method,
    ...(Array.isArray(method.params) && { params: method.params.map(toDraft07ContentDescriptor) }),
    ...(method.result !== undefined && { result: toDraft07ContentDescriptor(method.result) }),
  }
}

function toDraft07ContentDescriptor(
  descriptor: OpenRPCContentDescriptorObject | OpenRPCReferenceObject,
): OpenRPCContentDescriptorObject | OpenRPCReferenceObject {
  // a spec override can put anything here, only content descriptors carry a schema
  if (!isPlainObject(descriptor) || !Object.hasOwn(descriptor, 'schema')) {
    return descriptor
  }

  const contentDescriptor = descriptor as OpenRPCContentDescriptorObject

  return { ...contentDescriptor, schema: toDraft07JsonSchema(contentDescriptor.schema) }
}
