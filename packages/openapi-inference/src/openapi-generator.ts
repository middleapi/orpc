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
import { StandardJsonSchemaConverter } from '@orpc/json-schema'
import type {
  OpenAPIDocument,
  OpenAPIGeneratorGenerateOptions,
  OpenAPIGeneratorOptions,
  OpenAPIMeta,
  OpenAPIVersion,
} from '@orpc/openapi'
import { getOpenAPIMeta, OpenAPIGenerator, OpenAPIGeneratorError } from '@orpc/openapi'
import type { AnyRouter } from '@orpc/server'
import { walkProcedureContractsAsync } from '@orpc/server'
import { setOwn, stringifyJSON, toArray, value } from '@orpc/shared'
import type { Checker, Symbol as TSSymbol, Type } from 'typescript/unstable/sync'
import { TypeFlags } from 'typescript/unstable/sync'

import { mergeEquivalentComponents } from './components'
import type { TypeScriptProjectOptions } from './project'
import { openTypeScriptProject } from './project'
import type { ResolvedRouterType } from './router-type'
import { RouterTypeResolver } from './router-type'
import { withoutDescribedSchemas, withRequiredFrom } from './schema-subtraction'
import type {
  AsyncIteratorTypes,
  TypeToJsonSchemaConverterOptions,
  TypeToJsonSchemaConvertOptions,
} from './type-converter'
import { TypeScriptTypeResolutionError, TypeToJsonSchemaConverter } from './type-converter'
import type { SourceKind } from './utils'
import { createSourceKindChecker, getAssignedSymbol, getImplementedSymbol, getJSDoc } from './utils'

const INFERRED_JSON_SCHEMA_SYMBOL = Symbol('ORPC_TYPESCRIPT_INFERRED_JSON_SCHEMA')

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

class InferredJsonSchemaConverter implements JsonSchemaConverter {
  condition(schema: AnySchema | undefined): boolean {
    return schema !== undefined && INFERRED_JSON_SCHEMA_SYMBOL in schema['~standard']
  }

  convert(schema: AnySchema | undefined): [jsonSchema: JsonSchema, optional: boolean] {
    return (schema!['~standard'] as any)[INFERRED_JSON_SCHEMA_SYMBOL]
  }
}

interface InferenceContext {
  checker: Checker
  resolver: RouterTypeResolver
  converters: Record<JsonSchemaConverterDirection, TypeToJsonSchemaConverter>
  getSourceKind: (path: string) => SourceKind
}

export interface TypeScriptOpenAPIGeneratorOptions
  extends OpenAPIGeneratorOptions, Omit<TypeToJsonSchemaConverterOptions, 'direction'> {}

export interface TypeScriptOpenAPIGeneratorGenerateOptions<
  TVersion extends OpenAPIVersion,
> extends OpenAPIGeneratorGenerateOptions<TVersion> {
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
 * Generates an OpenAPI document like `OpenAPIGenerator`, inferring the JSON schemas
 * that no converter can produce from the router's TypeScript types,
 * so procedures without `.output` (or with type-only schemas) are fully documented.
 *
 * Schemas supported by `converters` are converted as usual, everything else falls back to type inference.
 * JSDoc comments of procedures fill `summary`, `description`, and `deprecated` when not set by `.route`, and `@tags` adds tags.
 *
 * @remarks
 * Generation runs the TypeScript 7 compiler on the source files, so it needs them at runtime.
 * Generate once (at build time or on first request) and reuse the document.
 *
 * @see {@link https://orpc.dev/docs/openapi/specification#type-inference | OpenAPI Specification - Type Inference}
 */
export class TypeScriptOpenAPIGenerator {
  private readonly converters: JsonSchemaConverter[]
  private readonly generator: OpenAPIGenerator

  constructor(private readonly options: TypeScriptOpenAPIGeneratorOptions = {}) {
    this.converters = [...toArray(options.converters), new StandardJsonSchemaConverter()]
    this.generator = new OpenAPIGenerator({
      ...options,
      converters: [new InferredJsonSchemaConverter(), ...toArray(options.converters)],
    })
  }

  async generate<TVersion extends OpenAPIVersion = '3.2.0'>(
    router: RouterContract | AnyRouter,
    { source, filter, ...options }: TypeScriptOpenAPIGeneratorGenerateOptions<TVersion>,
  ): Promise<OpenAPIDocument<TVersion>> {
    const project = openTypeScriptProject(source)

    let inferred: RouterContract
    let ctx: InferenceContext

    try {
      ctx = {
        checker: project.checker,
        resolver: new RouterTypeResolver(
          project.checker,
          project.getExportType(source.export ?? 'router'),
        ),
        converters: {
          input: new TypeToJsonSchemaConverter(project.checker, project.program, {
            ...this.options,
            direction: 'input',
          }),
          output: new TypeToJsonSchemaConverter(project.checker, project.program, {
            ...this.options,
            direction: 'output',
          }),
        },
        getSourceKind: createSourceKindChecker(project.program),
      }

      inferred = await this.inferRouter(ctx, router, filter)
    } finally {
      project.close()
    }

    const document = await this.generator.generate(inferred, options)
    mergeEquivalentComponents(document, ctx.converters.output.getDefNames())
    return document
  }

  private async inferRouter(
    ctx: InferenceContext,
    router: RouterContract | AnyRouter,
    filter: OpenAPIGeneratorGenerateOptions<OpenAPIVersion>['filter'],
  ): Promise<RouterContract> {
    let inferred: RouterContract = {}
    const errors: string[] = []

    await walkProcedureContractsAsync(router, (contract, path) => {
      if (value(filter, contract, path) === false) {
        return
      }

      try {
        const resolved = ctx.resolver.resolve(path)

        if (!resolved) {
          throw new OpenAPIGeneratorError(
            `its type was not found in the router type, make sure "source" points to the type of this router.`,
          )
        }

        const procedure = this.inferProcedure(ctx, contract, resolved)

        if (path.length === 0) {
          inferred = procedure
        } else {
          setAtPath(inferred, path, procedure)
        }
      } catch (e) {
        if (!(e instanceof OpenAPIGeneratorError || e instanceof TypeScriptTypeResolutionError)) {
          throw e
        }
        errors.push(`Procedure at ${path.length ? path.join('.') : '(root)'}: ${e.message}`)
      }
    })

    if (errors.length) {
      throw new OpenAPIGeneratorError(
        `[TypeScriptOpenAPIGenerator] Failed to infer types for the OpenAPI document (${errors.length} error${errors.length === 1 ? '' : 's'}):\n\n${errors.join('\n\n')}`,
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

    const meta = getOpenAPIMeta(contract)

    // the stock generator splits these into parts, where a def of the whole would be unused
    const inputDetailed = meta?.inputStructure === 'detailed'
    const outputDetailed = meta?.outputStructure === 'detailed'
    const inline: Record<JsonSchemaConverterDirection, TypeToJsonSchemaConvertOptions> = {
      input: {
        inlineRoot:
          inputDetailed ||
          meta?.method === 'GET' ||
          meta?.method === 'HEAD' ||
          `${meta?.prefix ?? ''}${meta?.path ?? ''}`.includes('{'),
        inlineProperties: inputDetailed ? ['params', 'query', 'headers'] : undefined,
      },
      output: {
        inlineRoot: outputDetailed,
        inlineProperties: outputDetailed ? ['status', 'headers'] : undefined,
      },
    }

    const isSupported = (schema: AnySchema, direction: JsonSchemaConverterDirection) =>
      this.converters.some((c) => c.condition(schema, direction))

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

      assertProcedureType(ctx, resolved)

      const type = ctx.resolver.getSchemaType(resolved.type, direction)

      if (!type) {
        return schemas
      }

      /**
       * Keeps the parts a converter supports, and adds the schemas inferred from their types,
       * without what the kept parts already describe (which keeps query parameters primitive),
       * when something is left.
       */
      const complete = (
        parts: AnySchema[],
        partTypes: (Type | readonly Type[] | undefined)[],
        options?: TypeToJsonSchemaConvertOptions,
      ): AnySchema[] => {
        if (parts.length && parts.every(supported)) {
          return parts
        }

        const inferred = partTypes.flatMap((t) =>
          t === undefined ? [] : [ctx.converters[direction].convert(t, options)],
        )

        // the kept schemas, also requiring the keys the type requires
        const kept = parts.filter(supported).map((schema) => {
          const [jsonSchema, optional] = this.converters
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
            return rest === undefined ? [] : [inferredSchema([rest, optional])]
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
        const returns = complete(
          iterator?.returnSchemas ?? [],
          iteratorTypes.map((t) => (hasReturn(t.returnTypes) ? t.returnTypes : undefined)),
        )

        return Array.from({ length: Math.max(yields.length, returns.length) }, (_, i) =>
          asyncIteratorObject(yields[i] ?? yields[0]!, returns[i]),
        )
      }

      return complete(schemas ?? [], [type], inline[direction])
    }

    const errorMap: ErrorMap = {}

    for (const code of Object.keys(def.errorMap)) {
      const config = def.errorMap[code]
      let dataType: Type | undefined

      if (config?.data && !isSupported(config.data, 'output')) {
        assertProcedureType(ctx, resolved)
        dataType = ctx.resolver.getErrorDataType(resolved.type, code)
      }

      setOwn(
        errorMap,
        code,
        dataType
          ? { ...config, data: inferredSchema(ctx.converters.output.convert(dataType)) }
          : config,
      )
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
 * Fills the OpenAPI meta from the procedure's JSDoc, keeping values set by `.route`.
 * The JSDoc is read from the router property, the variable assigned to it (`{ ping }`),
 * or the contract property either of them implements:
 * the first line is the `summary`, the rest the `description`,
 * `@summary`, `@description`, `@deprecated` override them, and `@tags` adds tags.
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

    if (tag.name === 'summary') {
      fromJSDoc.summary = text
    } else if (tag.name === 'description') {
      fromJSDoc.description = text
    } else if (tag.name === 'deprecated') {
      fromJSDoc.deprecated = true
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

  for (const key of ['summary', 'description', 'deprecated'] as const) {
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
