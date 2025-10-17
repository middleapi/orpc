import type { AnySchema } from '@orpc/contract'
import type { ConditionalSchemaConverter, JSONSchema, SchemaConvertOptions } from '@orpc/openapi'
import type { Interceptor } from '@orpc/shared'
import type {
  $ZodArray,
  $ZodCatch,
  $ZodDefault,
  $ZodEnum,
  $ZodFile,
  $ZodIntersection,
  $ZodLazy,
  $ZodLiteral,
  $ZodMap,
  $ZodNonOptional,
  $ZodNullable,
  $ZodNumber,
  $ZodObject,
  $ZodOptional,
  $ZodPipe,
  $ZodPrefault,
  $ZodReadonly,
  $ZodRecord,
  $ZodSet,
  $ZodString,
  $ZodTemplateLiteral,
  $ZodTuple,
  $ZodType,
  $ZodUnion,
} from 'zod/v4/core'
import { JsonSchemaXNativeType } from '@orpc/json-schema'
import { JSONSchemaContentEncoding, JSONSchemaFormat } from '@orpc/openapi'
import { intercept, toArray } from '@orpc/shared'
import {
  globalRegistry,
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
            const string = schema as $ZodString
            const json: JSONSchema & { allOf?: JSONSchema[] } = { type: 'string' }

            const { minimum, maximum, format, patterns, contentEncoding } = string._zod.bag

            if (typeof minimum === 'number') {
              json.minLength = minimum
            }

            if (typeof maximum === 'number') {
              json.maxLength = maximum
            }

            if (typeof contentEncoding === 'string') {
              json.contentEncoding = this.#handleContentEncoding(contentEncoding)
            }

            /**
             * JSON Schema's "regex" format means the string _is_ a regex pattern.
             * Zod's regex expects the string _to match_ a pattern.
             * These differ, so we ignore the "regex" format here.
             */
            if (typeof format === 'string' && format !== 'regex' && json.contentEncoding === undefined) {
              json.format = this.#handleStringFormat(format)
            }

            if (patterns instanceof Set && json.contentEncoding === undefined && json.format === undefined) {
              for (const pattern of patterns) {
                if (json.pattern === undefined) {
                  json.pattern = pattern.source
                }
                else {
                  json.allOf ??= []
                  json.allOf.push({ pattern: pattern.source })
                }
              }
            }

            // Add a pattern for JWT if it's missing (acts as a polyfill for Zod v4)
            if (format === 'jwt' && json.contentEncoding === undefined && json.format === undefined && json.pattern === undefined) {
              json.pattern = /^[\w-]+\.[\w-]+\.[\w-]+$/.source
            }

            return [true, json]
          }

          case 'number': {
            const number = schema as $ZodNumber
            const json: JSONSchema = { type: 'number' }

            const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = number._zod.bag

            if (typeof format === 'string' && format?.includes('int')) {
              json.type = 'integer'
            }

            if (typeof minimum === 'number') {
              json.minimum = minimum
            }

            if (typeof maximum === 'number') {
              json.maximum = maximum
            }

            if (typeof exclusiveMinimum === 'number') {
              json.exclusiveMinimum = exclusiveMinimum
            }

            if (typeof exclusiveMaximum === 'number') {
              json.exclusiveMaximum = exclusiveMaximum
            }

            if (typeof multipleOf === 'number') {
              json.multipleOf = multipleOf
            }

            return [true, json]
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
            const json: JSONSchema = { type: 'array' }

            const { minimum, maximum } = array._zod.bag

            if (typeof minimum === 'number') {
              json.minItems = minimum
            }

            if (typeof maximum === 'number') {
              json.maxItems = maximum
            }

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
              const [itemRequired, itemJson] = this.#convert(item, options, lazyDepth, structureDepth)

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

            return [required, anyOf.length === 1 ? anyOf[0]! : { anyOf }]
          }

          case 'intersection': {
            const intersection = schema as $ZodIntersection
            const json: JSONSchema & { allOf: Exclude<JSONSchema, boolean>[] } = { allOf: [] }

            let required = false

            for (const item of [intersection._zod.def.left, intersection._zod.def.right]) {
              const [itemRequired, itemJson] = this.#convert(item, options, lazyDepth, structureDepth)

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

            const { minimum, maximum } = tuple._zod.bag

            if (typeof minimum === 'number') {
              json.minItems = minimum
            }

            if (typeof maximum === 'number') {
              json.maxItems = maximum
            }

            return [true, json]
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
            return [true, { enum: Object.values(enum_._zod.def.entries) }]
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
            const file = schema as $ZodFile
            const oneOf: Exclude<JSONSchema, boolean>[] = []

            const { mime } = file._zod.bag

            if (mime === undefined || (Array.isArray(mime) && mime.every(m => typeof m === 'string'))) {
              for (const type of mime ?? ['*/*']) {
                oneOf.push({
                  type: 'string',
                  contentMediaType: type,
                })
              }
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
            return this.#convert(options.strategy === 'input' ? pipe._zod.def.in : pipe._zod.def.out, options, lazyDepth, structureDepth)
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
            const _unsupported: 'function' | 'int' | 'symbol' | 'promise' | 'custom' = schema._zod.def.type
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

  #handleStringFormat(format: string): string | undefined {
    if (format === 'guid') {
      return JSONSchemaFormat.UUID
    }

    if (format === 'url') {
      return JSONSchemaFormat.URI
    }

    if (format === 'datetime') {
      return JSONSchemaFormat.DateTime
    }

    return Object.values(JSONSchemaFormat).includes(format as any)
      ? format
      : undefined
  }

  #handleContentEncoding(contentEncoding: string): Exclude<JSONSchema, boolean>['contentEncoding'] | undefined {
    return Object.values(JSONSchemaContentEncoding).includes(contentEncoding as any)
      ? contentEncoding as any
      : undefined
  }
}
