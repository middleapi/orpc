import type {
  AnyProcedureContract,
  AnySchema,
  ErrorMap,
  Meta,
  RouterContract,
} from '@orpc/contract'
import {
  asyncIteratorObject,
  getAsyncIteratorObjectSchemasDetails,
  ProcedureContract,
} from '@orpc/contract'
import type {
  JsonSchema,
  JsonSchemaConverter,
  JsonSchemaConverterDirection,
} from '@orpc/json-schema'
import {
  extractJsonObjectSchemaEntries,
  isStandardSchemaOptional,
  isUnconstrainedSchema,
  StandardJsonSchemaConverter,
} from '@orpc/json-schema'
import type {
  OpenAPIDocument,
  OpenAPIGeneratorGenerateOptions as BaseOpenAPIGeneratorGenerateOptions,
  OpenAPIGeneratorOptions as BaseOpenAPIGeneratorOptions,
  OpenAPIMeta,
  OpenAPIVersion,
} from '@orpc/openapi'
import {
  OpenAPIGenerator as BaseOpenAPIGenerator,
  getDynamicPathParams,
  getOpenAPIMeta,
  OpenAPIGeneratorError,
} from '@orpc/openapi'
import type { AnyRouter } from '@orpc/server'
import { walkProcedureContractsAsync } from '@orpc/server'
import { setOwn, stringifyJSON, toArray, value } from '@orpc/shared'
import type { SourceFile } from 'typescript/unstable/ast'
import { SyntaxKind } from 'typescript/unstable/ast'
import type { Checker, Program, Symbol as TSSymbol, Type } from 'typescript/unstable/sync'
import { DiagnosticCategory, TypeFlags } from 'typescript/unstable/sync'

import { mergeEquivalentComponents } from './components'
import type { TypeScriptExport, TypeScriptProjectOptions } from './project'
import { openTypeScriptProject } from './project'
import type { ResolvedRouterType } from './router-type'
import { RouterTypeResolver } from './router-type'
import { withoutDescribedSchemas, withRequiredFrom } from './schema-subtraction'
import { admitsNull, withNull } from './schema-utils'
import type {
  AsyncIteratorTypes,
  ParameterFields,
  TypeToJsonSchemaConverterOptions,
  TypeToJsonSchemaConvertOptions,
} from './type-converter'
import { TypeScriptTypeResolutionError, TypeToJsonSchemaConverter } from './type-converter'
import type { SourceKind } from './utils'
import {
  createSourceKindChecker,
  formatDiagnostic,
  getAssignedSymbol,
  getImplementedSymbol,
  getJSDoc,
} from './utils'

const INFERRED_JSON_SCHEMA_SYMBOL = Symbol('ORPC_TYPESCRIPT_INFERRED_JSON_SCHEMA')

/**
 * Whether the `spec` object of a procedure gives its operation whole, which takes nothing from the types.
 */
function isGivenWhole(contract: AnyProcedureContract): boolean {
  const spec = getOpenAPIMeta(contract)?.spec
  return spec !== undefined && typeof spec !== 'function'
}

/** How many times the procedures are converted again at most, see `generate` */
const MAX_ALIAS_PASSES = 2

type InferredJsonSchema = [jsonSchema: JsonSchema, optional: boolean]

/**
 * A schema carrying a JSON schema inferred from TypeScript types,
 * standing in for a missing or unconvertible schema during generation.
 */
function inferredSchema(inferred: InferredJsonSchema): AnySchema {
  return {
    '~standard': {
      [INFERRED_JSON_SCHEMA_SYMBOL as any]: inferred,
      vendor: 'orpc-typescript',
      version: 1,
      validate: (value) => ({ value }),
    },
  }
}

/**
 * Whether a schema inferred from a type documents an object (a schema a converter supports is
 * documented as the stock generator documents it).
 */
function isInferredObject(schema: AnySchema): boolean {
  const inferred: InferredJsonSchema | undefined = (schema['~standard'] as any)[
    INFERRED_JSON_SCHEMA_SYMBOL
  ]
  return inferred === undefined || extractJsonObjectSchemaEntries(inferred[0]) !== undefined
}

class InferredJsonSchemaConverter implements JsonSchemaConverter {
  condition(schema: AnySchema | undefined): boolean {
    return schema !== undefined && INFERRED_JSON_SCHEMA_SYMBOL in schema['~standard']
  }

  convert(schema: AnySchema | undefined): [jsonSchema: JsonSchema, optional: boolean] {
    return (schema!['~standard'] as any)[INFERRED_JSON_SCHEMA_SYMBOL]
  }
}

type StandardJsonSchemaConversion = { jsonSchema: JsonSchema } | { error: unknown }

/**
 * The conversions of Standard JSON Schemas in one generation, which reads each schema as it is
 * then: a later generation picks up later changes, like metadata added to a Zod registry.
 */
type StandardJsonSchemaConversions = WeakMap<
  AnySchema,
  Partial<Record<JsonSchemaConverterDirection, StandardJsonSchemaConversion>>
>

/**
 * Converts a Standard JSON Schema once per direction, caching the result (or the thrown error),
 * since both deciding whether it converts and converting it need the conversion.
 */
function convertStandardJsonSchema(
  cache: StandardJsonSchemaConversions,
  schema: AnySchema,
  direction: JsonSchemaConverterDirection,
): StandardJsonSchemaConversion {
  let conversions = cache.get(schema)
  if (!conversions) {
    conversions = {}
    cache.set(schema, conversions)
  }

  if (!conversions[direction]) {
    try {
      conversions[direction] = {
        jsonSchema: (schema['~standard'] as any).jsonSchema[direction]({ target: 'draft-2020-12' }),
      }
    } catch (error) {
      conversions[direction] = { error }
    }
  }

  return conversions[direction]
}

/**
 * Converts Standard JSON Schemas like {@link StandardJsonSchemaConverter}, reusing each conversion.
 */
class CachedStandardJsonSchemaConverter extends StandardJsonSchemaConverter {
  constructor(protected readonly cache: StandardJsonSchemaConversions) {
    super()
  }

  override convert(
    schema: AnySchema | undefined,
    direction: JsonSchemaConverterDirection,
  ): [jsonSchema: JsonSchema, optional: boolean] {
    const conversion = convertStandardJsonSchema(this.cache, schema!, direction)

    return 'error' in conversion
      ? [{}, true]
      : [conversion.jsonSchema, isStandardSchemaOptional(schema!, direction)]
  }
}

/**
 * Converts the Standard JSON Schemas it can: one that throws (like a Zod date, which JSON Schema
 * can not represent) or converts to any value is inferred from its type, instead of documented as
 * any value.
 */
class ConvertibleStandardJsonSchemaConverter extends CachedStandardJsonSchemaConverter {
  override condition(
    schema: AnySchema | undefined,
    direction: JsonSchemaConverterDirection,
  ): boolean {
    if (!super.condition(schema, direction)) {
      return false
    }

    const conversion = convertStandardJsonSchema(this.cache, schema!, direction)
    return 'jsonSchema' in conversion && !isUnconstrainedSchema(conversion.jsonSchema)
  }
}

type Conversion = { result: [jsonSchema: JsonSchema, optional: boolean] } | { error: unknown }

/**
 * Converts as a converter of the options, once per schema and direction in one generation.
 */
class CachedJsonSchemaConverter implements JsonSchemaConverter {
  private readonly conversions = new WeakMap<
    AnySchema,
    Partial<Record<JsonSchemaConverterDirection, Conversion>>
  >()

  constructor(private readonly converter: JsonSchemaConverter) {}

  condition(schema: AnySchema | undefined, direction: JsonSchemaConverterDirection): boolean {
    return this.converter.condition(schema, direction)
  }

  /**
   * Whether it converts a schema to a schema: one it throws on (like Zod's transforms, with
   * `unrepresentable: 'throw'`) or converts to any value (with the default `any`) is inferred.
   */
  converts(schema: AnySchema | undefined, direction: JsonSchemaConverterDirection): boolean {
    if (!this.condition(schema, direction)) {
      return false
    }

    const conversion = this.getConversion(schema, direction)
    return 'result' in conversion && !isUnconstrainedSchema(conversion.result[0])
  }

  convert(
    schema: AnySchema | undefined,
    direction: JsonSchemaConverterDirection,
  ): [jsonSchema: JsonSchema, optional: boolean] {
    const conversion = this.getConversion(schema, direction)
    if ('error' in conversion) {
      throw conversion.error
    }
    return conversion.result
  }

  private getConversion(
    schema: AnySchema | undefined,
    direction: JsonSchemaConverterDirection,
  ): Conversion {
    const convert = (): Conversion => {
      try {
        return { result: this.converter.convert(schema, direction) }
      } catch (error) {
        return { error }
      }
    }

    if (schema === undefined) {
      return convert()
    }

    let conversions = this.conversions.get(schema)
    if (!conversions) {
      this.conversions.set(schema, (conversions = {}))
    }
    return (conversions[direction] ??= convert())
  }
}

interface InferenceContext {
  checker: Checker
  program: Program
  sourceFile: SourceFile
  /** The export `source` names, and its name */
  source: TypeScriptExport & { name: string }
  resolver: RouterTypeResolver
  converters: Record<JsonSchemaConverterDirection, TypeToJsonSchemaConverter>
  /** The converters of schemas kept as they are, the rest is inferred from types */
  schemaConverters: JsonSchemaConverter[]
  /**
   * The converters `OpenAPIGenerator` of `@orpc/openapi` uses, documenting a Standard JSON Schema
   * whose conversion throws as any value
   */
  stockConverters: JsonSchemaConverter[]
  getSourceKind: (path: string) => SourceKind
  describeConfig: () => readonly string[]
}

export interface OpenAPIGeneratorOptions
  extends BaseOpenAPIGeneratorOptions, Omit<TypeToJsonSchemaConverterOptions, 'direction'> {}

export interface OpenAPIGeneratorGenerateOptions<
  TVersion extends OpenAPIVersion,
> extends BaseOpenAPIGeneratorGenerateOptions<TVersion> {
  /**
   * Where the type of the router passed to `generate` is exported from.
   */
  source: TypeScriptRouterSource
}

export interface TypeScriptRouterSource extends TypeScriptProjectOptions {
  /**
   * The export name of the router (or contract) in `file`, use `default` for a default export.
   * It can be a value (`export const router = ...`) or a type (`export type Router = typeof router`).
   *
   * @default 'router'
   */
  export?: string | undefined
}

/**
 * Generates an OpenAPI document like `OpenAPIGenerator` of `@orpc/openapi`, inferring the JSON schemas
 * that no converter can produce from the router's TypeScript types,
 * so procedures without `.output` (or with type-only schemas) are fully documented.
 *
 * Schemas supported by `converters` are converted as usual, everything else (also a schema a converter
 * throws on or documents as any value) falls back to type inference.
 * JSDoc comments of procedures fill `summary`, `description`, `deprecated`, and (from `@returns`) `successDescription`
 * when the `openapi` metadata (`openapi(...)` or `.route`) does not set them, and `@tags` adds tags.
 *
 * @remarks
 * Generation runs the TypeScript 7 compiler on the source files, so it needs them at runtime.
 * Generate once (at build time or on first request) and reuse the document.
 *
 * @see {@link https://orpc.dev/docs/openapi/specification#type-inference | OpenAPI Specification - Type Inference}
 */
export class OpenAPIGenerator {
  constructor(private readonly options: OpenAPIGeneratorOptions = {}) {}

  async generate<TVersion extends OpenAPIVersion = '3.2.0'>(
    router: RouterContract | AnyRouter,
    { source, filter, componentName, ...options }: OpenAPIGeneratorGenerateOptions<TVersion>,
  ): Promise<OpenAPIDocument<TVersion>> {
    const project = openTypeScriptProject(source)
    // shared by deciding which schemas convert and by converting them, for this generation only
    const conversions: StandardJsonSchemaConversions = new WeakMap()
    const converters = toArray(this.options.converters).map((c) => new CachedJsonSchemaConverter(c))
    const stockConverters = [...converters, new CachedStandardJsonSchemaConverter(conversions)]

    let inferred: RouterContract
    let ctx: InferenceContext

    try {
      const name = source.export ?? 'router'
      const exported = { ...project.getExportType(name), name }
      const converter = (direction: JsonSchemaConverterDirection) =>
        new TypeToJsonSchemaConverter(project.checker, project.program, {
          ...this.options,
          direction,
        })

      ctx = {
        checker: project.checker,
        program: project.program,
        sourceFile: project.sourceFile,
        source: exported,
        resolver: new RouterTypeResolver(project.checker, project.program, exported),
        converters: { input: converter('input'), output: converter('output') },
        schemaConverters: [
          ...converters.map((c) => ({
            condition: c.converts.bind(c),
            convert: c.convert.bind(c),
          })),
          new ConvertibleStandardJsonSchemaConverter(conversions),
        ],
        stockConverters,
        getSourceKind: createSourceKindChecker(project.program),
        describeConfig: () => project.describeConfig(),
      }

      inferred = await this.inferRouter(ctx, router, filter)

      // a type converted before the file of a property naming it by an alias it lost was read is
      // converted again, so names do not depend on the order of procedures
      for (let i = 0; i < MAX_ALIAS_PASSES && ctx.converters.output.takeLateAliases(); i++) {
        ctx.converters = { input: converter('input'), output: converter('output') }
        inferred = await this.inferRouter(ctx, router, filter)
      }
    } finally {
      project.close()
    }

    // the components of `base` stay as they are, and the names `componentName` chose are merged as
    // defs of their def names
    const reserved = new Set(Object.keys(options.base?.components?.schemas ?? {}))
    const defNames = new Map<string, string>()
    const generator = new BaseOpenAPIGenerator({
      ...this.options,
      converters: [new InferredJsonSchemaConverter(), ...stockConverters],
    })
    const document = await generator.generate(inferred, {
      ...options,
      componentName:
        componentName &&
        ((defName, schema) => {
          const name = componentName(defName, schema)
          defNames.set(name, defName)
          return name
        }),
    })
    mergeEquivalentComponents(document, ctx.converters.output.getDefNames(), {
      reserved,
      defNames,
      rename: !componentName,
    })
    return document
  }

  private async inferRouter(
    ctx: InferenceContext,
    router: RouterContract | AnyRouter,
    filter: BaseOpenAPIGeneratorGenerateOptions<OpenAPIVersion>['filter'],
  ): Promise<RouterContract> {
    let inferred: RouterContract = {}
    const errors: string[] = []
    // printed once, many unresolved procedures share the errors of the router file
    let diagnostics: Set<string> | undefined
    let walked = 0
    let found = 0

    const place = (path: readonly string[], procedure: AnyProcedureContract) => {
      if (path.length === 0) {
        inferred = procedure
      } else {
        setAtPath(inferred, path, procedure)
      }
    }

    const procedures: { contract: AnyProcedureContract; path: readonly string[] }[] = []
    await walkProcedureContractsAsync(router, (contract, path) => {
      if (value(filter, contract, path) !== false) {
        procedures.push({ contract, path: [...path] })
      }
    })

    // the aliases of the files of the procedures, read first, so that a conversion seldom reaches
    // a type before the alias naming it (see `generate`)
    for (const { contract, path } of procedures) {
      const symbol = !isGivenWhole(contract) ? ctx.resolver.resolve(path)?.symbol : undefined
      if (symbol) {
        ctx.converters.output.readAliases([
          ...symbol.declarations,
          ...(getAssignedSymbol(ctx.checker, symbol)?.declarations ?? []),
          ...(getImplementedSymbol(ctx.checker, symbol)?.declarations ?? []),
        ])
      }
    }

    for (const { contract, path } of procedures) {
      // an operation the `spec` object gives whole takes nothing from the types
      if (isGivenWhole(contract)) {
        place(path, contract)
        continue
      }

      walked++
      let resolved: ResolvedRouterType | undefined

      try {
        resolved = ctx.resolver.resolve(path)

        if (!resolved) {
          throw new OpenAPIGeneratorError(
            `its type was not found in the router type, make sure "source" points to the type of this router.`,
          )
        }

        found++

        place(path, this.inferProcedure(ctx, contract, resolved))
      } catch (e) {
        if (!(e instanceof OpenAPIGeneratorError || e instanceof TypeScriptTypeResolutionError)) {
          throw e
        }
        // the compiler knows why a type is unresolved: a missing module, an undeclared name, ...
        if (e instanceof TypeScriptTypeResolutionError) {
          diagnostics ??= new Set(ctx.describeConfig())
          for (const diagnostic of getCompilerErrors(ctx, resolved, e)) {
            diagnostics.add(diagnostic)
          }
        }

        errors.push(`Procedure at ${path.length ? path.join('.') : '(root)'}: ${e.message}`)
      }
    }

    // no procedure is in the export's type: it is not a router, unlike a router of other paths
    if (walked && !found && !ctx.resolver.holdsProcedure()) {
      throw new OpenAPIGeneratorError(
        `[OpenAPIGenerator] The export "${ctx.source.name}" of "${ctx.sourceFile.fileName}" has type "${ctx.checker.typeToString(ctx.source.type)}", which is not a router, procedure or contract.`,
      )
    }

    if (errors.length) {
      // after where the compiler options come from, which an unresolved alias depends on
      const compilerErrors = diagnostics
        ? `\n\nCompiler errors:${[...diagnostics].map((d) => `\n  ${d}`).join('')}`
        : ''

      throw new OpenAPIGeneratorError(
        `[OpenAPIGenerator] Failed to infer types for the OpenAPI document (${errors.length} error${errors.length === 1 ? '' : 's'}):\n\n${errors.join('\n\n')}${compilerErrors}`,
      )
    }

    return inferred
  }

  private inferProcedure(
    ctx: InferenceContext,
    contract: AnyProcedureContract,
    resolved: ResolvedRouterType,
  ): AnyProcedureContract {
    const def = contract['~orpc']

    const { inline, parametersOnly } = getConvertOptions(getOpenAPIMeta(contract))

    const isSupported = (schema: AnySchema, direction: JsonSchemaConverterDirection) =>
      ctx.schemaConverters.some((c) => c.condition(schema, direction))

    /**
     * Infers a slot (an input, an output or error data) from its type, which `getType` reads from
     * the procedure type, `undefined` when it has none. Schemas the stock converters document (as
     * any value, when their conversion throws) keep that result (`undefined`) when the type can not
     * be read, like the type of a procedure typed `any`, see {@link inferWhenReadable}, or when
     * `keepsStock` rejects what is inferred. Any slot keeps it when the compiler can not send one
     * of its types, see {@link isUnsendableTypeError}.
     */
    const inferSlot = <T>(
      schemas: AnySchema[],
      direction: JsonSchemaConverterDirection,
      getType: (procedure: Type) => Type | undefined,
      infer: (type: Type) => T,
      keepsStock?: (inferred: T) => boolean,
    ): T | undefined => {
      try {
        if (
          schemas.length &&
          schemas.every((s) => ctx.stockConverters.some((c) => c.condition(s, direction)))
        ) {
          const inferred = inferWhenReadable(ctx, resolved, getType, infer)
          return inferred !== undefined && keepsStock?.(inferred) ? undefined : inferred
        }

        assertProcedureType(ctx, resolved)
        const type = getType(resolved.type)
        return type && infer(type)
      } catch (error) {
        if (isUnsendableTypeError(error)) {
          return undefined
        }

        throw error
      }
    }

    /**
     * Keeps the schemas a converter supports, and adds one inferred from the type for the rest:
     * several schemas of a slot are combined with `allOf`, and the type is their intersection.
     */
    const inferSchemas = (
      schemas: AnySchema[] | undefined,
      direction: JsonSchemaConverterDirection,
    ): AnySchema[] | undefined => {
      const supported = (s: AnySchema) => isSupported(s, direction)
      const iterator = getAsyncIteratorObjectSchemasDetails(schemas)
      const leaves = iterator
        ? [...iterator.yieldSchemas, ...iterator.returnSchemas]
        : (schemas ?? [])

      if (leaves.length && leaves.every(supported)) {
        return schemas
      }

      const inferFromType = (type: Type): AnySchema[] => {
        /**
         * Keeps the parts a converter supports, and adds the schemas inferred from their types,
         * without what the kept parts already describe (which keeps query parameters primitive),
         * when something is left.
         */
        const complete = (
          parts: AnySchema[],
          partTypes: (Type | readonly Type[] | undefined)[],
          options?: TypeToJsonSchemaConvertOptions,
          output = false,
        ): AnySchema[] => {
          if (parts.length && parts.every(supported)) {
            return parts
          }

          const inferred = partTypes.flatMap((t) =>
            t === undefined ? [] : [ctx.converters[direction].convert(t, options)],
          )

          // the kept schemas, also requiring the keys the type requires
          const kept = parts.filter(supported).map((schema) => {
            const [jsonSchema, optional] = ctx.schemaConverters
              .find((c) => c.condition(schema, direction))!
              .convert(schema, direction)
            // a recursive schema (`$ref: '#'`) shares its levels, so the inferred part keeps them
            const required = /"\$ref":"#(?:\/properties\/[^"]*)?"/u.test(stringifyJSON(jsonSchema)!)
              ? jsonSchema
              : withRequiredFrom(
                  jsonSchema,
                  inferred.map(([s]) => s),
                )

            return {
              schema: required === jsonSchema ? schema : inferredSchema([required, optional]),
              jsonSchema: required,
            }
          })

          const described = kept.map((k) => k.jsonSchema)

          return [
            ...kept.map((k) => k.schema),
            ...inferred.flatMap(([jsonSchema, optional]) => {
              const rest = withoutDescribedSchemas(jsonSchema, described)
              return rest === undefined
                ? []
                : [
                    inferredSchema([
                      output && !kept.length
                        ? withNullBody(rest, optional, !!inline.output.inlineRoot)
                        : rest,
                      optional,
                    ]),
                  ]
            }),
          ]
        }

        const iteratorTypes = getAllAsyncIteratorTypes(ctx.converters[direction], type)

        // event streams, completing the yield and return parts separately
        if (iteratorTypes.length) {
          const yields = complete(
            iterator?.yieldSchemas ?? [],
            iteratorTypes.map((t) => t.yieldTypes),
          )
          // iterators returning nothing (`void`) close without data
          const returns =
            !iterator?.returnSchemas.length && iteratorTypes.every((t) => !t.returnTypes.length)
              ? [inferredSchema([{ not: {} }, true])]
              : complete(
                  iterator?.returnSchemas ?? [],
                  iteratorTypes.map((t) => (hasReturn(t.returnTypes) ? t.returnTypes : undefined)),
                )

          return Array.from({ length: Math.max(yields.length, returns.length) }, (_, i) =>
            asyncIteratorObject(yields[i] ?? yields[0]!, returns[i]),
          )
        }

        return complete(schemas ?? [], [type], inline[direction], direction === 'output')
      }

      return (
        inferSlot(
          leaves,
          direction,
          (procedure) => ctx.resolver.getSchemaType(procedure, direction),
          inferFromType,
          // a parameters-only input not inferred as an object would fail to generate
          (inferred) =>
            direction === 'input' && parametersOnly && !inferred.every(isInferredObject),
        ) ?? schemas
      )
    }

    const errorMap: ErrorMap = {}

    for (const code of Object.keys(def.errorMap)) {
      const config = def.errorMap[code]
      let data: AnySchema | undefined

      if (config?.data && !isSupported(config.data, 'output')) {
        data = inferSlot(
          [config.data],
          'output',
          (procedure) => ctx.resolver.getErrorDataType(procedure, code),
          (dataType) => inferredSchema(ctx.converters.output.convert(dataType, { awaited: false })),
        )
      }

      setOwn(errorMap, code, data ? { ...config, data } : config)
    }

    return new ProcedureContract({
      ...def,
      inputSchemas: inferSchemas(def.inputSchemas, 'input'),
      outputSchemas: inferSchemas(def.outputSchemas, 'output'),
      errorMap,
      meta: withJSDocMeta(ctx, def.meta, resolved.symbol),
    })
  }
}

/**
 * How the input and output of a procedure are converted, as the stock generator documents them.
 */
function getConvertOptions(meta: OpenAPIMeta | undefined): {
  inline: Record<JsonSchemaConverterDirection, TypeToJsonSchemaConvertOptions>
  /** Whether the stock generator reads only parameters from the input, the fields of an object */
  parametersOnly: boolean
} {
  // the stock generator splits these into parts, where a def of the whole would be unused
  const inputDetailed = meta?.inputStructure === 'detailed'
  const outputDetailed = meta?.outputStructure === 'detailed'
  // a client sends no request body with these
  const bodiless = meta?.method === 'GET' || meta?.method === 'HEAD'
  // the stock generator reads only parameters from these inputs, the fields of an object
  const parametersOnly = inputDetailed || bodiless
  const pathParameters =
    getDynamicPathParams(`${meta?.prefix ?? ''}${meta?.path ?? ''}` as `/${string}`)?.map(
      (p) => p.parameterName,
    ) ?? []
  const inline: Record<JsonSchemaConverterDirection, TypeToJsonSchemaConvertOptions> = {
    input: {
      inlineRoot: parametersOnly || pathParameters.length > 0,
      inlineProperties: inputDetailed ? ['params', 'query', 'headers'] : undefined,
      partialProperties: inputDetailed ? ['query', 'headers'] : undefined,
      // the query parameters of a compact input without a body
      separateRootFields: bodiless && !inputDetailed,
      // only a whole input sent as the request body, not in the query string of a GET request
      body: !parametersOnly && !pathParameters.length,
      bodyProperty: inputDetailed && !bodiless,
      // what a client sends in the URL with bracket notation, all of a compact input without a
      // body, but the values of a style, which are sent in their serialized forms
      parameters: getParameterFields(meta, inputDetailed, bodiless, pathParameters),
      // a client sends a promise as is, written as `{}`
      awaited: false,
    },
    output: {
      inlineRoot: outputDetailed,
      inlineProperties: outputDetailed ? ['status', 'headers'] : undefined,
      // what a member leaves out (`status?: undefined` of a union of object literals) is not sent,
      // and the stock generator reads which headers each status sends from its members
      separateRootFields: outputDetailed,
      separateProperties: outputDetailed ? ['headers'] : undefined,
      body: true,
      bodyProperty: outputDetailed,
    },
  }

  return { inline, parametersOnly }
}

/**
 * An output whose body may be left out, which the serializer writes as `null`: a compact one that
 * may be (`T | undefined`), or a detailed one whose `body` may be (`body?: T`), also of each member
 * of a union. No body (`void`) stays any value (see `toBodyContent` of `@orpc/openapi`), and so
 * does a schema admitting `null` already.
 */
function withNullBody(
  schema: JsonSchema,
  optional: boolean,
  detailed: boolean,
  $defs = typeof schema === 'object' ? schema.$defs : undefined,
): JsonSchema {
  if (typeof schema !== 'object') {
    return schema
  }

  if (detailed) {
    if (schema.anyOf) {
      return { ...schema, anyOf: schema.anyOf.map((m) => withNullBody(m, optional, true, $defs)) }
    }

    const body = schema.properties?.body
    if (body === undefined) {
      return schema
    }

    const nullable = withNullBody(body, !schema.required?.includes('body'), false, $defs)
    return nullable === body
      ? schema
      : { ...schema, properties: { ...schema.properties, body: nullable } }
  }

  if (!optional || admitsNull(schema, $defs)) {
    return schema
  }

  const { $defs: own, ...rest } = schema
  const nullable = withNull(rest)
  return own && typeof nullable === 'object' ? { ...nullable, $defs: own } : nullable
}

/**
 * The names of the parameters of a style, not the bracket notation.
 */
function getStyledNames(styles: Readonly<Record<string, unknown>> | undefined): string[] {
  return Object.entries(styles ?? {}).flatMap(([name, style]) =>
    style === undefined ? [] : [name],
  )
}

/**
 * The fields of an object holding parameters, all of them but these.
 */
function getFieldsExcept(except: string[]): true | ParameterFields {
  return except.length === 0 || { except }
}

/**
 * The fields of an input a client sends in the URL with bracket notation (see
 * `TypeToJsonSchemaConvertOptions.parameters`): those of the query string and the path, but the
 * ones of a style (`queryStyles`, `paramsStyles`), whose values are sent in their serialized forms.
 */
function getParameterFields(
  meta: OpenAPIMeta | undefined,
  inputDetailed: boolean,
  bodiless: boolean,
  pathParameters: readonly string[],
): boolean | ParameterFields {
  const queryStyled = getStyledNames(meta?.queryStyles)
  const paramsStyled = getStyledNames(meta?.paramsStyles).filter((name) =>
    pathParameters.includes(name),
  )

  if (inputDetailed) {
    return {
      only: { params: getFieldsExcept(paramsStyled), query: getFieldsExcept(queryStyled) },
    }
  }

  if (bodiless) {
    return getFieldsExcept([...new Set([...queryStyled, ...paramsStyled])])
  }

  const sent = pathParameters.filter((name) => !paramsStyled.includes(name))
  return sent.length > 0 && { only: Object.fromEntries(sent.map((name) => [name, true])) }
}

/**
 * Inference needs the type of a procedure: it fails when the type is not resolved,
 * instead of documenting `{}`.
 */
function assertProcedureType(ctx: InferenceContext, resolved: ResolvedRouterType): void {
  if (resolved.type.isErrorType()) {
    throw new TypeScriptTypeResolutionError(
      `Could not resolve its type "${ctx.checker.typeToString(resolved.type)}". Check its import, and the tsconfig "paths" for aliases like "@/".`,
    )
  }

  if (!ctx.resolver.isProcedure(resolved.type)) {
    throw new OpenAPIGeneratorError(
      `its type "${ctx.checker.typeToString(resolved.type)}" is not a procedure or contract, make sure "source" points to the type of this router.`,
    )
  }
}

/**
 * Infers a slot the stock converters document, when its type can be read: a procedure typed
 * `any`, a slot typed `any` or `unknown`, or a type the conversion can not resolve keeps the
 * stock result instead (`undefined`), as the slot was documented before it was inferred.
 */
function inferWhenReadable<T>(
  ctx: InferenceContext,
  resolved: ResolvedRouterType,
  getType: (procedure: Type) => Type | undefined,
  infer: (type: Type) => T,
): T | undefined {
  if (resolved.type.isErrorType() || !ctx.resolver.isProcedure(resolved.type)) {
    return undefined
  }

  const type = getType(resolved.type)

  if (!type || type.isErrorType() || type.flags & (TypeFlags.Any | TypeFlags.Unknown)) {
    return undefined
  }

  try {
    return infer(type)
  } catch (e) {
    if (e instanceof OpenAPIGeneratorError || e instanceof TypeScriptTypeResolutionError) {
      return undefined
    }

    throw e
  }
}

/**
 * The compiler fails to send a type JSON can not write, the literal of `Infinity` (type-fest's
 * `PositiveInfinity`) or of `-Infinity`, also among the types of a request.
 */
function isUnsendableTypeError(error: unknown): boolean {
  return error instanceof Error && /unsupported value: [+-]Inf\b/u.test(error.message)
}

/**
 * The compiler errors of the files declaring a procedure (the router file, and where a procedure
 * assigned to it, `{ ping }`, is declared), and of the project files the conversion went through
 * to reach an unresolved type.
 */
function getCompilerErrors(
  ctx: InferenceContext,
  resolved: ResolvedRouterType | undefined,
  error: TypeScriptTypeResolutionError,
): string[] {
  const files = new Set<string>([ctx.sourceFile.fileName])

  for (const symbol of [
    resolved?.symbol,
    resolved?.symbol && getAssignedSymbol(ctx.checker, resolved.symbol),
  ]) {
    for (const declaration of symbol?.declarations ?? []) {
      files.add(declaration.path)
    }
  }

  for (const file of error.files) {
    if (ctx.getSourceKind(file) === 'project') {
      files.add(file)
    }
  }

  return [...files]
    .flatMap((file) => [
      ...ctx.program.getSyntacticDiagnostics(file),
      ...ctx.program.getSemanticDiagnostics(file),
    ])
    .filter((d) => d.category === DiagnosticCategory.Error)
    .map((d) => formatDiagnostic(ctx.program, d))
    .concat(getUnresolvedModules(ctx, error.files))
}

/**
 * The modules the declaration files the conversion went through import and the compiler does not
 * find, which it reports nowhere under `skipLibCheck`, like a dependency of a built package that
 * is not installed where it runs (`import("@standard-server/shared").AsyncIteratorClass<...>`).
 */
function getUnresolvedModules(ctx: InferenceContext, files: Iterable<string>): string[] {
  const specifiers: any[] = []
  const visit = (node: any): undefined => {
    // of an import or export declaration, or an import type
    const specifier =
      node.kind === SyntaxKind.ImportType ? node.argument?.literal : node.moduleSpecifier
    if (specifier?.kind === SyntaxKind.StringLiteral) {
      specifiers.push(specifier)
    }

    node.forEachChild(visit)
    return undefined
  }

  for (const file of files) {
    const sourceFile = /\.d\.[cm]?ts$/u.test(file) ? ctx.program.getSourceFile(file) : undefined
    if (sourceFile) {
      visit(sourceFile)
    }
  }

  if (!specifiers.length) {
    return []
  }

  return ctx.checker.getSymbolAtLocation(specifiers).flatMap((symbol, i) => {
    if (symbol) {
      return []
    }

    const specifier = specifiers[i]
    const sourceFile = specifier.getSourceFile()
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(specifier.pos)
    return [
      `${sourceFile.fileName}:${line + 1}:${character + 1} - Cannot find module "${specifier.text}", which this declaration file imports.`,
    ]
  })
}

/**
 * The yield and return types of an async iterator, one per member of an intersection
 * of async iterators (several `eventIterator` schemas).
 */
function getAllAsyncIteratorTypes(
  converter: TypeToJsonSchemaConverter,
  type: Type,
): AsyncIteratorTypes[] {
  const types = converter.getAsyncIteratorTypes(type)

  if (types) {
    return [types]
  }

  if (!type.isIntersectionType()) {
    return []
  }

  const members = type.getTypes().map((member) => converter.getAsyncIteratorTypes(member))
  return members.every((m) => m !== undefined) ? (members as AsyncIteratorTypes[]) : []
}

/**
 * Whether an iterator returns a value worth documenting, not `void` or `any`.
 */
function hasReturn(types: readonly Type[]): boolean {
  return types.length > 0 && !types.some((t) => t.flags & (TypeFlags.Any | TypeFlags.Unknown))
}

/**
 * Fills the OpenAPI meta from the procedure's JSDoc, keeping values set by the `openapi` metadata.
 * The JSDoc is read from the router property, the variable assigned to it (`{ ping }`),
 * or the contract property either of them implements:
 * the first line is the `summary`, the rest the `description`,
 * `@summary`, `@description`, `@deprecated` override them, `@returns` is the `successDescription`, and `@tags` adds tags.
 */
function withJSDocMeta(ctx: InferenceContext, meta: Meta, symbol: TSSymbol | undefined): Meta {
  if (!symbol) {
    return meta
  }

  const read = (other: TSSymbol | undefined) =>
    other && getJSDoc(ctx.checker, other, ctx.getSourceKind)

  let jsdoc = read(symbol)

  // the variable assigned to the property (`{ ping }`), or the contract either implements
  if (!jsdoc) {
    const assigned = getAssignedSymbol(ctx.checker, symbol)
    jsdoc =
      read(assigned) ??
      read(getImplementedSymbol(ctx.checker, symbol)) ??
      read(assigned && getImplementedSymbol(ctx.checker, assigned))
  }

  if (!jsdoc) {
    return meta
  }

  const { comment, tags } = jsdoc

  const [firstLine = '', ...rest] = comment.split('\n')
  const fromJSDoc: OpenAPIMeta = {
    summary: firstLine.trim() || undefined,
    description: rest.join('\n').trim() || undefined,
  }

  for (const tag of tags) {
    const text = tag.text?.trim() ?? ''

    // an empty `@summary` or `@description` keeps the one taken from the comment
    if (tag.name === 'summary') {
      fromJSDoc.summary = text || fromJSDoc.summary
    } else if (tag.name === 'description') {
      fromJSDoc.description = text || fromJSDoc.description
    } else if (tag.name === 'deprecated') {
      fromJSDoc.deprecated = true
    } else if (tag.name === 'returns' || tag.name === 'return') {
      fromJSDoc.successDescription = text || fromJSDoc.successDescription
    } else if (tag.name === 'tags' || tag.name === 'tag') {
      fromJSDoc.tags = [
        ...(fromJSDoc.tags ?? []),
        ...text
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      ]
    }
  }

  const openapi = (meta['~openapi'] ?? {}) as OpenAPIMeta
  const merged: OpenAPIMeta = { ...openapi }

  for (const key of ['summary', 'description', 'deprecated', 'successDescription'] as const) {
    if (merged[key] === undefined && fromJSDoc[key] !== undefined) {
      ;(merged as Record<string, unknown>)[key] = fromJSDoc[key]
    }
  }

  // tags concatenate, like `openapi({ tags })` does, so router-level tags keep JSDoc tags
  if (fromJSDoc.tags?.length) {
    merged.tags = [...new Set([...(merged.tags ?? []), ...fromJSDoc.tags])]
  }

  return { ...meta, '~openapi': merged }
}

function setAtPath(router: Record<string, any>, path: readonly string[], procedure: unknown): void {
  let current = router

  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i]!

    if (!Object.hasOwn(current, segment)) {
      setOwn(current, segment, {})
    }

    current = current[segment]
  }

  setOwn(current, path.at(-1)!, procedure)
}
