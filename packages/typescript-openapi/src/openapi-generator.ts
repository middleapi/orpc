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
import { setOwn, toArray, value } from '@orpc/shared'
import type { Checker, Symbol as TSSymbol, Type } from 'typescript/unstable/sync'
import { TypeFlags } from 'typescript/unstable/sync'

import type { TypeScriptProjectOptions } from './project.ts'
import { openTypeScriptProject } from './project.ts'
import type { ResolvedRouterType } from './router-type.ts'
import { RouterTypeResolver } from './router-type.ts'
import type { TypeToJsonSchemaConverterOptions } from './type-converter.ts'
import { TypeScriptTypeResolutionError, TypeToJsonSchemaConverter } from './type-converter.ts'
import { createLibraryPathChecker, getAssignedSymbol, getJSDoc } from './utils.ts'

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
  converter: TypeToJsonSchemaConverter
  isLibraryPath: (path: string) => boolean
}

export interface TypeScriptOpenAPIGeneratorOptions
  extends OpenAPIGeneratorOptions, TypeToJsonSchemaConverterOptions {}

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
 * JSDoc comments of procedures fill `summary`, `description`, `deprecated`, and `tags` when not set by `.route`.
 *
 * @remarks
 * Generation runs the TypeScript 7 compiler on the source files, so it needs them at runtime.
 * Generate once (at build time or on first request) and reuse the document.
 *
 * @see {@link https://orpc.dev/docs/openapi/type-inference | OpenAPI Type Inference}
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

    try {
      const ctx: InferenceContext = {
        checker: project.checker,
        resolver: new RouterTypeResolver(
          project.checker,
          project.getExportType(source.export ?? 'router'),
        ),
        converter: new TypeToJsonSchemaConverter(project.checker, project.program, this.options),
        isLibraryPath: createLibraryPathChecker(project.program),
      }

      inferred = await this.inferRouter(ctx, router, filter)
    } finally {
      project.close()
    }

    return this.generator.generate(inferred, options)
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
    const inlineRoot = {
      input:
        meta?.inputStructure === 'detailed' ||
        meta?.method === 'GET' ||
        meta?.method === 'HEAD' ||
        `${meta?.prefix ?? ''}${meta?.path ?? ''}`.includes('{'),
      output: meta?.outputStructure === 'detailed',
    }

    const inferSchemas = (
      schemas: AnySchema[] | undefined,
      direction: JsonSchemaConverterDirection,
    ): AnySchema[] | undefined => {
      if (this.isConvertible(schemas, direction)) {
        return schemas
      }

      if (!ctx.resolver.isProcedure(resolved.type)) {
        throw new OpenAPIGeneratorError(
          `its type "${ctx.checker.typeToString(resolved.type)}" is not a procedure or contract, make sure "source" points to the type of this router.`,
        )
      }

      const type = ctx.resolver.getSchemaType(resolved.type, direction)
      return type ? [toInferredSchema(ctx.converter, type, inlineRoot[direction])] : schemas
    }

    const errorMap: ErrorMap = {}

    for (const code of Object.keys(def.errorMap)) {
      const config = def.errorMap[code]
      const dataType =
        config?.data && !this.isConvertible([config.data], 'output')
          ? ctx.resolver.getErrorDataType(resolved.type, code)
          : undefined

      setOwn(
        errorMap,
        code,
        dataType ? { ...config, data: toInferredSchema(ctx.converter, dataType, false) } : config,
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

  private isConvertible(
    schemas: AnySchema[] | undefined,
    direction: JsonSchemaConverterDirection,
  ): boolean {
    if (!schemas?.length) {
      return false
    }

    const iterator = getAsyncIteratorObjectSchemasDetails(schemas)
    const leaves = iterator ? [...iterator.yieldSchemas, ...iterator.returnSchemas] : schemas

    return leaves.every((schema) => this.converters.some((c) => c.condition(schema, direction)))
  }
}

/**
 * Infers a schema from a type, an async iterator becomes an `asyncIteratorObject` schema.
 */
function toInferredSchema(
  converter: TypeToJsonSchemaConverter,
  type: Type,
  inlineRoot: boolean,
): AnySchema {
  const iterator = converter.getAsyncIteratorTypes(type)

  if (iterator) {
    const hasReturn = !(
      iterator.returnType.flags &
      (TypeFlags.Void | TypeFlags.Undefined | TypeFlags.Any | TypeFlags.Unknown)
    )

    return asyncIteratorObject(
      inferredSchema(converter.convert(iterator.yieldType)),
      hasReturn ? inferredSchema(converter.convert(iterator.returnType)) : undefined,
    )
  }

  return inferredSchema(converter.convert(type, { inlineRoot }))
}

/**
 * Fills the OpenAPI meta from the procedure's JSDoc, keeping values set by `.route`.
 * The JSDoc is read from the router property, or the variable assigned to it (`{ ping }`):
 * the first line is the `summary`, the rest the `description`,
 * `@summary`, `@description`, `@deprecated` override them, and `@tags` adds tags.
 */
function withJSDocMeta(ctx: InferenceContext, meta: Meta, symbol: TSSymbol | undefined): Meta {
  if (!symbol) {
    return meta
  }

  let jsdoc = getJSDoc(ctx.checker, symbol, ctx.isLibraryPath)

  if (!jsdoc) {
    const assigned = getAssignedSymbol(ctx.checker, symbol)
    jsdoc = assigned && getJSDoc(ctx.checker, assigned, ctx.isLibraryPath)
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
