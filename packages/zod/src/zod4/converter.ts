import type { AnySchema } from '@orpc/contract'
import type { ConditionalSchemaConverter, JSONSchema, SchemaConvertOptions } from '@orpc/openapi'
import type { Interceptor } from '@orpc/shared'
import type {
  $ZodArray,
  $ZodCatch,
  $ZodCheck,
  $ZodDefault,
  $ZodEnum,
  $ZodIntersection,
  $ZodLazy,
  $ZodLiteral,
  $ZodMap,
  $ZodNonOptional,
  $ZodNullable,
  $ZodObject,
  $ZodOptional,
  $ZodPipe,
  $ZodPrefault,
  $ZodReadonly,
  $ZodRecord,
  $ZodSet,
  $ZodTemplateLiteral,
  $ZodTuple,
  $ZodType,
  $ZodUnion,
} from 'zod/v4/core'
import { JsonSchemaXNativeType } from '@orpc/json-schema'
import { JSONSchemaFormat } from '@orpc/openapi'
import { guard, intercept, toArray } from '@orpc/shared'
import {
  globalRegistry,
  registry,
  toJSONSchema,
} from 'zod/v4/core'
import {
  JSON_SCHEMA_INPUT_REGISTRY,
  JSON_SCHEMA_OUTPUT_REGISTRY,
  JSON_SCHEMA_REGISTRY,
} from './registries'

export interface ZodToJsonSchemaConverterOptions {
  /**
   * Max depth of lazy type.
   *
   * Used anyJsonSchema (`{}`) when exceed max depth
   *
   * @default 2
   */
  maxLazyDepth?: number

  /**
   * Max depth of nested types.
   *
   * Used anyJsonSchema (`{}`) when exceed max depth
   *
   * @default 10
   */
  maxStructureDepth?: number

  /**
   * The schema to be used to represent the any | unknown type.
   *
   * @default { }
   */
  anyJsonSchema?: Exclude<JSONSchema, boolean>

  /**
   * The schema to be used when the Zod schema is unsupported.
   *
   * @default { not: {} }
   */
  unsupportedJsonSchema?: Exclude<JSONSchema, boolean>

  /**
   * The schema to be used to represent the undefined type.
   *
   * @default { not: {} }
   */
  undefinedJsonSchema?: Exclude<JSONSchema, boolean>

  interceptors?: Interceptor<
    { schema: $ZodType, options: SchemaConvertOptions, lazyDepth: number, isHandledCustomJSONSchema: boolean },
    [required: boolean, jsonSchema: Exclude<JSONSchema, boolean>]
  >[]
}

export class ZodToJsonSchemaConverter implements ConditionalSchemaConverter {
  private readonly maxLazyDepth: Exclude<ZodToJsonSchemaConverterOptions['maxLazyDepth'], undefined>
  private readonly maxStructureDepth: Exclude<ZodToJsonSchemaConverterOptions['maxStructureDepth'], undefined>
  private readonly anyJsonSchema: Exclude<ZodToJsonSchemaConverterOptions['anyJsonSchema'], undefined>
  private readonly unsupportedJsonSchema: Exclude<ZodToJsonSchemaConverterOptions['unsupportedJsonSchema'], undefined>
  private readonly undefinedJsonSchema: Exclude<ZodToJsonSchemaConverterOptions['undefinedJsonSchema'], undefined>
  private readonly interceptors: Exclude<ZodToJsonSchemaConverterOptions['interceptors'], undefined>

  constructor(options: ZodToJsonSchemaConverterOptions = {}) {
    this.maxLazyDepth = options.maxLazyDepth ?? 2
    this.maxStructureDepth = options.maxStructureDepth ?? 10
    this.anyJsonSchema = options.anyJsonSchema ?? {}
    this.unsupportedJsonSchema = options.unsupportedJsonSchema ?? { not: {} }
    this.undefinedJsonSchema = options.undefinedJsonSchema ?? { not: {} }
    this.interceptors = options.interceptors ?? []
  }

  condition(schema: AnySchema | undefined): boolean {
    return schema !== undefined && schema['~standard'].vendor === 'zod' && '_zod' in schema // >= zod4
  }

  convert(
    schema: AnySchema | undefined,
    options: SchemaConvertOptions,
  ): [required: boolean, jsonSchema: Exclude<JSONSchema, boolean>] {
    return this.#convert(schema as $ZodType, options, 0, 0)
  }

  #convert(
    schema: $ZodType,
    options: SchemaConvertOptions,
    lazyDepth: number,
    structureDepth: number,
    isHandledCustomJSONSchema: boolean = false,
  ): [required: boolean, jsonSchema: Exclude<JSONSchema, boolean>] {
    return intercept(
      this.interceptors,
      { schema, options, lazyDepth, isHandledCustomJSONSchema },
      ({ schema, options, lazyDepth, isHandledCustomJSONSchema }) => {
        if (structureDepth > this.maxStructureDepth) {
          return [false, this.anyJsonSchema]
        }

        if (!options.minStructureDepthForRef || options.minStructureDepthForRef <= structureDepth) {
          const components = toArray(options.components)

          for (const component of components) {
            if (component.schema === schema && component.allowedStrategies.includes(options.strategy)) {
              return [component.required, { $ref: component.ref }]
            }
          }
        }

        if (!isHandledCustomJSONSchema) {
          const customJSONSchema = this.#getCustomJsonSchema(schema, options)

          if (customJSONSchema) {
            const [required, json] = this.#convert(schema, options, lazyDepth, structureDepth, true)

            return [required, { ...json, ...customJSONSchema }]
          }
        }

        switch (schema._zod.def.type) {
          case 'string': {
            return [true, { type: 'string', ...nativeJsonSchema(schema, options.strategy) }]
          }

          case 'number': {
            return [true, { type: 'number', ...nativeJsonSchema(schema, options.strategy) }]
          }

          case 'boolean': {
            return [true, { type: 'boolean' }]
          }

          case 'bigint': {
            return [true, {
              'type': 'string',
              'pattern': '^-?[0-9]+$',
              'x-native-type': JsonSchemaXNativeType.BigInt,
            }]
          }

          case 'date': {
            return [true, {
              'type': 'string',
              'format': JSONSchemaFormat.DateTime,
              'x-native-type': JsonSchemaXNativeType.Date,
            }]
          }

          case 'null': {
            return [true, { type: 'null' }]
          }

          case 'undefined':
          case 'void': {
            return [false, this.undefinedJsonSchema]
          }

          case 'any': {
            return [false, this.anyJsonSchema]
          }

          case 'unknown': {
            return [false, this.anyJsonSchema]
          }

          case 'never': {
            return [true, this.unsupportedJsonSchema]
          }

          case 'array': {
            const array = schema as $ZodArray
            const json: JSONSchema = { type: 'array', ...itemBounds(array, options.strategy) }

            json.items = this.#handleArrayItemJsonSchema(this.#convert(array._zod.def.element, options, lazyDepth, structureDepth + 1), options)

            return [true, json]
          }

          case 'object': {
            const object = schema as $ZodObject
            const json: JSONSchema & { required?: string[] } = { type: 'object' }

            for (const [key, value] of Object.entries(object._zod.def.shape)) {
              const [itemRequired, itemJson] = this.#convert(value, options, lazyDepth, structureDepth + 1)

              json.properties ??= {}
              json.properties[key] = itemJson

              if (itemRequired) {
                json.required ??= []
                json.required.push(key)
              }
            }

            if (object._zod.def.catchall) {
              if (object._zod.def.catchall._zod.def.type === 'never') {
                json.additionalProperties = false
              }
              else {
                const [_, addJson] = this.#convert(object._zod.def.catchall, options, lazyDepth, structureDepth + 1)
                json.additionalProperties = addJson
              }
            }

            return [true, json]
          }

          case 'union': {
            const union = schema as $ZodUnion
            const anyOf: Exclude<JSONSchema, boolean>[] = []

            let required = true

            for (const item of union._zod.def.options) {
              const [itemRequired, itemJson] = this.#convert(item, options, lazyDepth, structureDepth + 1)

              if (!itemRequired) {
                required = false
              }

              if (options.strategy === 'input') {
                if (itemJson !== this.undefinedJsonSchema && itemJson !== this.unsupportedJsonSchema) {
                  anyOf.push(itemJson)
                }
              }
              else {
                if (itemJson !== this.undefinedJsonSchema) {
                  anyOf.push(itemJson)
                }
              }
            }

            return [required, { anyOf }]
          }

          case 'intersection': {
            const intersection = schema as $ZodIntersection
            const json: JSONSchema & { allOf: Exclude<JSONSchema, boolean>[] } = { allOf: [] }

            let required = false

            for (const item of [intersection._zod.def.left, intersection._zod.def.right]) {
              const [itemRequired, itemJson] = this.#convert(item, options, lazyDepth, structureDepth + 1)

              json.allOf.push(itemJson)

              if (itemRequired) {
                required = true
              }
            }

            return [required, json]
          }

          case 'tuple': {
            const tuple = schema as $ZodTuple
            const json: JSONSchema & { prefixItems: JSONSchema[] } = { type: 'array', prefixItems: [] }

            for (const item of tuple._zod.def.items) {
              json.prefixItems.push(this.#handleArrayItemJsonSchema(this.#convert(item, options, lazyDepth, structureDepth + 1), options))
            }

            if (tuple._zod.def.rest) {
              json.items = this.#handleArrayItemJsonSchema(this.#convert(tuple._zod.def.rest, options, lazyDepth, structureDepth + 1), options)
            }

            return [true, { ...json, ...itemBounds(tuple, options.strategy) }]
          }

          case 'record': {
            const record = schema as $ZodRecord
            const json: JSONSchema = { type: 'object' }

            json.propertyNames = (this.#convert(record._zod.def.keyType, options, lazyDepth, structureDepth + 1))[1]
            json.additionalProperties = (this.#convert(record._zod.def.valueType, options, lazyDepth, structureDepth + 1))[1]

            return [true, json]
          }

          case 'map': {
            const map = schema as $ZodMap

            return [true, {
              'type': 'array',
              'items': {
                type: 'array',
                prefixItems: [
                  this.#handleArrayItemJsonSchema(this.#convert(map._zod.def.keyType, options, lazyDepth, structureDepth + 1), options),
                  this.#handleArrayItemJsonSchema(this.#convert(map._zod.def.valueType, options, lazyDepth, structureDepth + 1), options),
                ],
                maxItems: 2,
                minItems: 2,
              },
              'x-native-type': JsonSchemaXNativeType.Map,
            }]
          }

          case 'set': {
            const set = schema as $ZodSet
            return [true, {
              'type': 'array',
              'uniqueItems': true,
              'items': this.#handleArrayItemJsonSchema(this.#convert(set._zod.def.valueType, options, lazyDepth, structureDepth + 1), options),
              'x-native-type': JsonSchemaXNativeType.Set,
            }]
          }

          case 'enum': {
            const enum_ = schema as $ZodEnum
            const values = getEnumValues(enum_._zod.def.entries)
            const json: any = { enum: values }

            if (values.every(v => typeof v === 'string')) {
              json.type = 'string'
            }
            else if (values.every(v => Number.isFinite(v))) {
              json.type = 'number'
            }

            return [true, json]
          }

          case 'literal': {
            const literal = schema as $ZodLiteral

            let required = true
            const values = new Set<string | number | boolean | null>()

            for (const value of literal._zod.def.values) {
              if (value === undefined) {
                required = false
              }
              else {
                values.add(typeof value === 'bigint' ? value.toString() : value)
              }
            }

            const json: JSONSchema = values.size === 0
              ? this.undefinedJsonSchema
              : values.size === 1
                ? { const: values.values().next().value }
                : { enum: Array.from(values) }

            return [required, json]
          }

          case 'file': {
            const oneOf: Exclude<JSONSchema, boolean>[] = []

            const mime = rawMimeTypes(schema)

            for (const type of mime ?? ['*/*']) {
              oneOf.push({
                type: 'string',
                contentMediaType: type,
              })
            }

            return [true, oneOf.length === 1 ? oneOf[0]! : { anyOf: oneOf }]
          }

          case 'transform': {
            return [false, this.anyJsonSchema]
          }

          case 'nullable': {
            const nullable = schema as $ZodNullable

            const [required, json] = this.#convert(nullable._zod.def.innerType, options, lazyDepth, structureDepth)

            return [required, { anyOf: [json, { type: 'null' }] }]
          }

          case 'nonoptional': {
            const nonoptional = schema as $ZodNonOptional
            const [, json] = this.#convert(nonoptional._zod.def.innerType, options, lazyDepth, structureDepth)
            return [true, json]
          }

          case 'success': {
            return [true, { type: 'boolean' }]
          }

          case 'default':
          case 'prefault': {
            const default_ = schema as $ZodDefault | $ZodPrefault
            const [, json] = this.#convert(default_._zod.def.innerType, options, lazyDepth, structureDepth)

            return [false, {
              ...json,
              default: default_._zod.def.defaultValue,
            }]
          }

          case 'catch': {
            const catch_ = schema as $ZodCatch
            return this.#convert(catch_._zod.def.innerType, options, lazyDepth, structureDepth)
          }

          case 'nan': {
            return [true, options.strategy === 'input' ? this.unsupportedJsonSchema : { type: 'null' }]
          }

          case 'pipe': {
            const pipe = schema as $ZodPipe
            return this.#convert(
              // prefer out schema when in schema is preprocess/transform
              options.strategy === 'input' && pipe._zod.def.in._zod.def.type !== 'transform'
                ? pipe._zod.def.in
                : pipe._zod.def.out,
              options,
              lazyDepth,
              structureDepth,
            )
          }

          case 'readonly': {
            const readonly_ = schema as $ZodReadonly
            const [required, json] = this.#convert(readonly_._zod.def.innerType, options, lazyDepth, structureDepth)
            return [required, { ...json, readOnly: true }]
          }

          case 'template_literal': {
            const templateLiteral = schema as $ZodTemplateLiteral

            return [true, {
              type: 'string',
              pattern: templateLiteral._zod.pattern.source,
            }]
          }

          case 'optional': {
            const optional = schema as $ZodOptional
            const [, json] = this.#convert(optional._zod.def.innerType, options, lazyDepth, structureDepth)
            return [false, json]
          }

          case 'lazy': {
            const lazy = schema as $ZodLazy

            const currentLazyDepth = lazyDepth + 1

            if (currentLazyDepth > this.maxLazyDepth) {
              return [false, this.anyJsonSchema]
            }

            return this.#convert(lazy._zod.def.getter(), options, currentLazyDepth, structureDepth)
          }

          default: {
            const _unsupported: 'function' | 'int' | 'symbol' | 'promise' | 'custom' | 'properties' = schema._zod.def.type
            return [true, this.unsupportedJsonSchema]
          }
        }
      },
    )
  }

  #getCustomJsonSchema(schema: $ZodType, options: SchemaConvertOptions): Exclude<JSONSchema, boolean> | undefined {
    if (options.strategy === 'input' && JSON_SCHEMA_INPUT_REGISTRY.has(schema)) {
      return JSON_SCHEMA_INPUT_REGISTRY.get(schema) as Exclude<JSONSchema, boolean> | undefined
    }

    if (options.strategy === 'output' && JSON_SCHEMA_OUTPUT_REGISTRY.has(schema)) {
      return JSON_SCHEMA_OUTPUT_REGISTRY.get(schema) as Exclude<JSONSchema, boolean> | undefined
    }

    if (JSON_SCHEMA_REGISTRY.has(schema)) {
      return JSON_SCHEMA_REGISTRY.get(schema) as Exclude<JSONSchema, boolean> | undefined
    }

    const global = globalRegistry.get(schema)

    if (global) {
      return {
        title: global.title,
        description: global.description,
        examples: Array.isArray(global.examples) ? global.examples : undefined,
      }
    }
  }

  #handleArrayItemJsonSchema([required, schema]: [required: boolean, jsonSchema: Exclude<JSONSchema, boolean>], options: SchemaConvertOptions): Exclude<JSONSchema, boolean> {
    if (required || options.strategy === 'input' || schema.default !== undefined) {
      return schema
    }

    if (schema === this.undefinedJsonSchema) {
      return { type: 'null' }
    }

    return {
      anyOf: [ // schema can contain { type: 'null' } so we should use anyOf instead of oneOf
        schema,
        { type: 'null' },
      ],
    }
  }
}

type EnumValue = string | number // | bigint | boolean | symbol;
type EnumLike = Readonly<Record<string, EnumValue>>
/**
 * https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/core/util.ts#L206C8-L212C2
 */
function getEnumValues(entries: EnumLike): EnumValue[] {
  const numericValues = Object.values(entries).filter(v => typeof v === 'number')
  const values = Object.entries(entries)
    .filter(([k, _]) => !numericValues.includes(+k))
    .map(([_, v]) => v)
  return values
}

/**
 * Metadata is looked up in an empty registry so Zod's output carries only what the checks say:
 * oRPC applies titles and descriptions itself, and an `id` would turn the schema into a `$ref`
 * into `$defs` that carries none of its own keywords.
 */
const NO_METADATA = registry<Record<string, any>>()

/**
 * The JSON Schema Zod itself derives from a schema, the source of truth for what its checks say.
 */
function nativeJsonSchema(schema: $ZodType, strategy: SchemaConvertOptions['strategy']): Record<string, any> {
  // Zod refuses some schemas outright, those go without constraints
  const native = guard(() => toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: strategy,
    unrepresentable: 'any',
    metadata: NO_METADATA,
  }))

  // oRPC's documents are always draft/2020-12, so the dialect is left off every schema in them
  const { $schema, ...json } = native ?? {}

  return json
}

/**
 * The length Zod's checks put on an array or a tuple.
 */
function itemBounds(schema: $ZodType, strategy: SchemaConvertOptions['strategy']): { minItems?: number, maxItems?: number } {
  const { minItems, maxItems } = nativeJsonSchema(schema, strategy)

  return {
    ...typeof minItems === 'number' ? { minItems } : {},
    ...typeof maxItems === 'number' ? { maxItems } : {},
  }
}

/**
 * The media types a file schema accepts. Zod folds repeated `.mime()` calls by intersecting them,
 * which oRPC's `anyOf` branches cannot express, so the last one wins here as it always has.
 */
function rawMimeTypes(schema: $ZodType): string[] | undefined {
  let mime: string[] | undefined

  for (const check of toArray((schema._zod.def as { checks?: $ZodCheck[] }).checks)) {
    const def = check._zod.def as { check?: string, mime?: unknown }

    if (def.check === 'mime_type' && Array.isArray(def.mime)) {
      mime = def.mime
    }
  }

  return mime
}
