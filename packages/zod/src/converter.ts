import type { AnySchema } from '@orpc/contract'
import type { ConditionalSchemaConverter, JSONSchema, SchemaConvertOptions } from '@orpc/openapi'
import type {
  EnumLike,
  KeySchema,
  ZodAny,
  ZodArray,
  ZodBranded,
  ZodCatch,
  ZodDefault,
  ZodDiscriminatedUnion,
  ZodEffects,
  ZodEnum,
  ZodIntersection,
  ZodLazy,
  ZodLiteral,
  ZodMap,
  ZodNativeEnum,
  ZodNullable,
  ZodNumber,
  ZodObject,
  ZodOptional,
  ZodPipeline,
  ZodRawShape,
  ZodReadonly,
  ZodRecord,
  ZodSet,
  ZodString,
  ZodTuple,
  ZodTypeAny,
  ZodTypeDef,
  ZodUnion,
  ZodUnionOptions,
} from 'zod/v3'
import { JsonSchemaXNativeType } from '@orpc/json-schema'
import { JSONSchemaFormat } from '@orpc/openapi'
import { toArray } from '@orpc/shared'
import escapeStringRegexp from 'escape-string-regexp'
import { ZodFirstPartyTypeKind } from 'zod/v3'
import { getCustomJsonSchema } from './custom-json-schema'
import { getCustomZodDef } from './schemas/base'

export interface ZodToJsonSchemaOptions {
  /**
   * Max depth of lazy type
   *
   * Used `{}` when exceed max depth
   *
   * @default 3
   */
  maxLazyDepth?: number

  /**
   * Max depth of nested types
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
}

export class ZodToJsonSchemaConverter implements ConditionalSchemaConverter {
  private readonly maxLazyDepth: Exclude<ZodToJsonSchemaOptions['maxLazyDepth'], undefined>
  private readonly maxStructureDepth: Exclude<ZodToJsonSchemaOptions['maxStructureDepth'], undefined>
  private readonly unsupportedJsonSchema: Exclude<ZodToJsonSchemaOptions['unsupportedJsonSchema'], undefined>
  private readonly anyJsonSchema: Exclude<ZodToJsonSchemaOptions['anyJsonSchema'], undefined>

  constructor(options: ZodToJsonSchemaOptions = {}) {
    this.maxLazyDepth = options.maxLazyDepth ?? 3
    this.maxStructureDepth = options.maxStructureDepth ?? 10
    this.unsupportedJsonSchema = options.unsupportedJsonSchema ?? { not: {} }
    this.anyJsonSchema = options.anyJsonSchema ?? {}
  }

  condition(schema: AnySchema | undefined): boolean {
    return schema !== undefined && schema['~standard'].vendor === 'zod' && !('_zod' in schema) // < zod4
  }

  convert(
    schema: AnySchema | undefined,
    options: SchemaConvertOptions,
    lazyDepth = 0,
    isHandledCustomJSONSchema = false,
    isHandledZodDescription = false,
    structureDepth = 0,
  ): [required: boolean, jsonSchema: Exclude<JSONSchema, boolean>] {
    const def = (schema as ZodTypeAny)._def

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

    if (!isHandledZodDescription && 'description' in def && typeof def.description === 'string') {
      const [required, json] = this.convert(
        schema,
        options,
        lazyDepth,
        isHandledCustomJSONSchema,
        true,
        structureDepth,
      )

      return [required, { ...json, description: def.description }]
    }

    if (!isHandledCustomJSONSchema) {
      const customJSONSchema = getCustomJsonSchema(def, options)

      if (customJSONSchema) {
        const [required, json] = this.convert(
          schema,
          options,
          lazyDepth,
          true,
          isHandledZodDescription,
          structureDepth,
        )

        return [required, { ...json, ...customJSONSchema }]
      }
    }

    const customSchema = this.#handleCustomZodDef(def)

    if (customSchema) {
      return [true, customSchema]
    }

    const typeName = this.#getZodTypeName(def)

    switch (typeName) {
      case ZodFirstPartyTypeKind.ZodString: {
        const schema_ = schema as ZodString

        const json: JSONSchema = { type: 'string' }

        for (const check of schema_._def.checks) {
          switch (check.kind) {
            case 'base64':
              json.contentEncoding = 'base64'
              break
            case 'cuid':
              json.pattern = '^[0-9A-HJKMNP-TV-Z]{26}$'
              break
            case 'email':
              json.format = JSONSchemaFormat.Email
              break
            case 'url':
              json.format = JSONSchemaFormat.URI
              break
            case 'uuid':
              json.format = JSONSchemaFormat.UUID
              break
            case 'regex':
              json.pattern = check.regex.source
              break
            case 'min':
              json.minLength = check.value
              break
            case 'max':
              json.maxLength = check.value
              break
            case 'length':
              json.minLength = check.value
              json.maxLength = check.value
              break
            case 'includes':
              json.pattern = escapeStringRegexp(check.value)
              break
            case 'startsWith':
              json.pattern = `^${escapeStringRegexp(check.value)}`
              break
            case 'endsWith':
              json.pattern = `${escapeStringRegexp(check.value)}$`
              break
            case 'emoji':
              json.pattern
                = '^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$'
              break
            case 'nanoid':
              json.pattern = '^[a-zA-Z0-9_-]{21}$'
              break
            case 'cuid2':
              json.pattern = '^[0-9a-z]+$'
              break
            case 'ulid':
              json.pattern = '^[0-9A-HJKMNP-TV-Z]{26}$'
              break
            case 'datetime':
              json.format = JSONSchemaFormat.DateTime
              break
            case 'date':
              json.format = JSONSchemaFormat.Date
              break
            case 'time':
              json.format = JSONSchemaFormat.Time
              break
            case 'duration':
              json.format = JSONSchemaFormat.Duration
              break
            case 'ip': {
              if (check.version === 'v4') {
                json.format = JSONSchemaFormat.IPv4
              }
              else if (check.version === 'v6') {
                json.format = JSONSchemaFormat.IPv6
              }
              else {
                json.anyOf = [
                  { format: JSONSchemaFormat.IPv4 },
                  { format: JSONSchemaFormat.IPv6 },
                ]
              }

              break
            }
            case 'jwt':
              json.pattern = '^[A-Za-z0-9-_]+\\.[A-Za-z0-9-_]+\\.[A-Za-z0-9-_]*$'
              break
            case 'base64url':
              json.pattern = '^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$'
              break
            default: {
              const _expect: 'toLowerCase' | 'toUpperCase' | 'trim' | 'cidr' = check.kind
            }
          }
        }

        return [true, json]
      }

      case ZodFirstPartyTypeKind.ZodNumber: {
        const schema_ = schema as ZodNumber

        const json: JSONSchema = { type: 'number' }

        for (const check of schema_._def.checks) {
          switch (check.kind) {
            case 'int':
              json.type = 'integer'
              break
            case 'min':
              json.minimum = check.value
              break
            case 'max':
              json.maximum = check.value
              break
            case 'multipleOf':
              json.multipleOf = check.value
              break
            default: {
              const _expect: 'finite' = check.kind
            }
          }
        }

        return [true, json]
      }

      case ZodFirstPartyTypeKind.ZodBigInt: {
        const json: JSONSchema & { 'x-native-type': JsonSchemaXNativeType.BigInt } = {
          'type': 'string',
          'pattern': '^-?[0-9]+$',
          'x-native-type': JsonSchemaXNativeType.BigInt,
        }

        // WARN: ignore checks

        return [true, json]
      }

      case ZodFirstPartyTypeKind.ZodNaN: {
        return options.strategy === 'input'
          ? [true, this.unsupportedJsonSchema]
          : [true, { type: 'null' }]
      }

      case ZodFirstPartyTypeKind.ZodBoolean: {
        return [true, { type: 'boolean' }]
      }

      case ZodFirstPartyTypeKind.ZodDate: {
        const schema: JSONSchema & { 'x-native-type': JsonSchemaXNativeType.Date } = {
          'type': 'string',
          'format': JSONSchemaFormat.DateTime,
          'x-native-type': JsonSchemaXNativeType.Date,
        }

        // WARN: ignore checks

        return [true, schema]
      }

      case ZodFirstPartyTypeKind.ZodNull: {
        return [true, { type: 'null' }]
      }

      case ZodFirstPartyTypeKind.ZodLiteral: {
        const schema_ = schema as ZodLiteral<unknown>

        if (schema_._def.value === undefined) {
          return [false, this.unsupportedJsonSchema]
        }

        return [true, { const: schema_._def.value }]
      }

      case ZodFirstPartyTypeKind.ZodVoid:
      case ZodFirstPartyTypeKind.ZodUndefined: {
        return [false, this.unsupportedJsonSchema]
      }

      case ZodFirstPartyTypeKind.ZodUnknown:
      case ZodFirstPartyTypeKind.ZodAny: {
        return [false, this.anyJsonSchema]
      }

      case ZodFirstPartyTypeKind.ZodEnum: {
        const schema_ = schema as ZodEnum<[string, ...string[]]>

        return [true, { enum: schema_._def.values }]
      }

      case ZodFirstPartyTypeKind.ZodNativeEnum: {
        const schema_ = schema as ZodNativeEnum<EnumLike>

        return [true, { enum: Object.values(schema_._def.values) }]
      }

      case ZodFirstPartyTypeKind.ZodArray: {
        const schema_ = schema as ZodArray<ZodTypeAny>
        const def = schema_._def

        const json: JSONSchema = { type: 'array' }

        const [itemRequired, itemJson] = this.convert(def.type, options, lazyDepth, false, false, structureDepth + 1)

        json.items = this.#toArrayItemJsonSchema(itemRequired, itemJson, options.strategy)

        if (def.exactLength) {
          json.maxItems = def.exactLength.value
          json.minItems = def.exactLength.value
        }

        if (def.minLength) {
          json.minItems = def.minLength.value
        }

        if (def.maxLength) {
          json.maxItems = def.maxLength.value
        }

        return [true, json]
      }

      case ZodFirstPartyTypeKind.ZodTuple: {
        const schema_ = schema as ZodTuple<[ZodTypeAny, ...ZodTypeAny[]], ZodTypeAny | null>

        const prefixItems: JSONSchema[] = []
        const json: JSONSchema = { type: 'array' }

        for (const item of schema_._def.items) {
          const [itemRequired, itemJson] = this.convert(item, options, lazyDepth, false, false, structureDepth + 1)

          prefixItems.push(
            this.#toArrayItemJsonSchema(itemRequired, itemJson, options.strategy),
          )
        }

        if (prefixItems?.length) {
          json.prefixItems = prefixItems
        }

        if (schema_._def.rest) {
          const [itemRequired, itemJson] = this.convert(schema_._def.rest, options, lazyDepth, false, false, structureDepth + 1)

          json.items = this.#toArrayItemJsonSchema(itemRequired, itemJson, options.strategy)
        }

        return [true, json]
      }

      case ZodFirstPartyTypeKind.ZodObject: {
        const schema_ = schema as ZodObject<ZodRawShape>

        const json: JSONSchema = { type: 'object' }
        const properties: Record<string, JSONSchema> = {}
        const required: string[] = []

        for (const [key, value] of Object.entries(schema_.shape)) {
          const [itemRequired, itemJson] = this.convert(value, options, lazyDepth, false, false, structureDepth + 1)

          properties[key] = itemJson

          if (itemRequired) {
            required.push(key)
          }
        }

        if (Object.keys(properties).length) {
          json.properties = properties
        }

        if (required.length) {
          json.required = required
        }

        const catchAllTypeName = this.#getZodTypeName(schema_._def.catchall._def)

        if (catchAllTypeName === ZodFirstPartyTypeKind.ZodNever) {
          if (schema_._def.unknownKeys === 'strict') {
            json.additionalProperties = false
          }
        }
        else {
          const [_, addJson] = this.convert(schema_._def.catchall, options, lazyDepth, false, false, structureDepth + 1)

          json.additionalProperties = addJson
        }

        return [true, json]
      }

      case ZodFirstPartyTypeKind.ZodRecord: {
        const schema_ = schema as ZodRecord<KeySchema, ZodAny>

        const json: JSONSchema = { type: 'object' }

        const [__, keyJson] = this.convert(schema_._def.keyType, options, lazyDepth, false, false, structureDepth + 1)

        if (Object.entries(keyJson).some(([k, v]) => k !== 'type' || v !== 'string')) {
          json.propertyNames = keyJson
        }

        const [_, itemJson] = this.convert(schema_._def.valueType, options, lazyDepth, false, false, structureDepth + 1)

        json.additionalProperties = itemJson

        return [true, json]
      }

      case ZodFirstPartyTypeKind.ZodSet: {
        const schema_ = schema as ZodSet

        const json: JSONSchema & { 'x-native-type': JsonSchemaXNativeType.Set } = {
          'type': 'array',
          'uniqueItems': true,
          'x-native-type': JsonSchemaXNativeType.Set,
        }

        const [itemRequired, itemJson] = this.convert(schema_._def.valueType, options, lazyDepth, false, false, structureDepth + 1)

        json.items = this.#toArrayItemJsonSchema(itemRequired, itemJson, options.strategy)

        return [true, json]
      }

      case ZodFirstPartyTypeKind.ZodMap: {
        const schema_ = schema as ZodMap

        const [keyRequired, keyJson] = this.convert(schema_._def.keyType, options, lazyDepth, false, false, structureDepth + 1)
        const [valueRequired, valueJson] = this.convert(schema_._def.valueType, options, lazyDepth, false, false, structureDepth + 1)

        const json: JSONSchema & { 'x-native-type': JsonSchemaXNativeType.Map } = {
          'type': 'array',
          'items': {
            type: 'array',
            prefixItems: [
              this.#toArrayItemJsonSchema(keyRequired, keyJson, options.strategy),
              this.#toArrayItemJsonSchema(valueRequired, valueJson, options.strategy),
            ],
            maxItems: 2,
            minItems: 2,
          },
          'x-native-type': JsonSchemaXNativeType.Map,
        }

        return [true, json]
      }

      case ZodFirstPartyTypeKind.ZodUnion:
      case ZodFirstPartyTypeKind.ZodDiscriminatedUnion: {
        const schema_ = schema as
          | ZodUnion<ZodUnionOptions>
          | ZodDiscriminatedUnion<string, [ZodObject<any>, ...ZodObject<any>[]]>

        const anyOf: Exclude<JSONSchema, boolean>[] = []
        let required = true

        for (const item of schema_._def.options) {
          const [itemRequired, itemJson] = this.convert(item, options, lazyDepth, false, false, structureDepth + 1)

          if (!itemRequired) {
            required = false

            if (itemJson !== this.unsupportedJsonSchema) {
              anyOf.push(itemJson)
            }
          }
          else {
            anyOf.push(itemJson)
          }
        }

        return [required, { anyOf }]
      }

      case ZodFirstPartyTypeKind.ZodIntersection: {
        const schema_ = schema as ZodIntersection<ZodTypeAny, ZodTypeAny>

        const allOf: JSONSchema[] = []
        let required: boolean = false

        for (const item of [schema_._def.left, schema_._def.right]) {
          const [itemRequired, itemJson] = this.convert(item, options, lazyDepth, false, false, structureDepth + 1)

          allOf.push(itemJson)

          if (itemRequired) {
            required = true
          }
        }

        return [required, { allOf }]
      }

      case ZodFirstPartyTypeKind.ZodLazy: {
        const currentLazyDepth = lazyDepth + 1

        if (currentLazyDepth > this.maxLazyDepth) {
          return [false, this.anyJsonSchema]
        }

        const schema_ = schema as ZodLazy<ZodTypeAny>

        return this.convert(schema_._def.getter(), options, currentLazyDepth, false, false, structureDepth)
      }

      case ZodFirstPartyTypeKind.ZodOptional: {
        const schema_ = schema as ZodOptional<ZodTypeAny>

        const [_, inner] = this.convert(schema_._def.innerType, options, lazyDepth, false, false, structureDepth)

        return [false, inner]
      }

      case ZodFirstPartyTypeKind.ZodReadonly: {
        const schema_ = schema as ZodReadonly<ZodTypeAny>
        const [required, json] = this.convert(schema_._def.innerType, options, lazyDepth, false, false, structureDepth)

        return [required, { ...json, readOnly: true }]
      }

      case ZodFirstPartyTypeKind.ZodDefault: {
        const schema_ = schema as ZodDefault<ZodTypeAny>

        const [_, json] = this.convert(schema_._def.innerType, options, lazyDepth, false, false, structureDepth)

        return [false, { default: schema_._def.defaultValue(), ...json }]
      }

      case ZodFirstPartyTypeKind.ZodEffects: {
        const schema_ = schema as ZodEffects<ZodTypeAny>

        if (schema_._def.effect.type === 'transform' && options.strategy === 'output') {
          return [false, this.anyJsonSchema]
        }

        return this.convert(schema_._def.schema, options, lazyDepth, false, false, structureDepth)
      }

      case ZodFirstPartyTypeKind.ZodCatch: {
        const schema_ = schema as ZodCatch<ZodTypeAny>
        return this.convert(schema_._def.innerType, options, lazyDepth, false, false, structureDepth)
      }

      case ZodFirstPartyTypeKind.ZodBranded: {
        const schema_ = schema as ZodBranded<ZodTypeAny, string | number | symbol>
        return this.convert(schema_._def.type, options, lazyDepth, false, false, structureDepth)
      }

      case ZodFirstPartyTypeKind.ZodPipeline: {
        const schema_ = schema as ZodPipeline<ZodTypeAny, ZodTypeAny>

        return this.convert(
          options.strategy === 'input' ? schema_._def.in : schema_._def.out,
          options,
          lazyDepth,
          false,
          false,
          structureDepth,
        )
      }

      case ZodFirstPartyTypeKind.ZodNullable: {
        const schema_ = schema as ZodNullable<ZodTypeAny>

        const [required, json] = this.convert(schema_._def.innerType, options, lazyDepth, false, false, structureDepth)

        return [required, { anyOf: [json, { type: 'null' }] }]
      }
    }

    const _expected:
      | undefined
      | ZodFirstPartyTypeKind.ZodPromise
      | ZodFirstPartyTypeKind.ZodSymbol
      | ZodFirstPartyTypeKind.ZodFunction
      | ZodFirstPartyTypeKind.ZodNever = typeName

    return [true, this.unsupportedJsonSchema]
  }

  #handleCustomZodDef(def: ZodTypeDef): Exclude<JSONSchema & Record<string, unknown>, boolean> | undefined {
    const customZodDef = getCustomZodDef(def)

    if (!customZodDef) {
      return undefined
    }

    switch (customZodDef.type) {
      case 'blob': {
        return { type: 'string', contentMediaType: '*/*' }
      }

      case 'file': {
        return { type: 'string', contentMediaType: customZodDef.mimeType ?? '*/*' }
      }

      case 'regexp': {
        return {
          'type': 'string',
          'pattern': '^\\/(.*)\\/([a-z]*)$',
          'x-native-type': JsonSchemaXNativeType.RegExp,
        }
      }

      case 'url': {
        return {
          'type': 'string',
          'format': JSONSchemaFormat.URI,
          'x-native-type': JsonSchemaXNativeType.Url,
        }
      }

      /* v8 ignore next 3 */
      default: {
        const _expect: never = customZodDef
      }
    }
  }

  #getZodTypeName(def: ZodTypeDef): ZodFirstPartyTypeKind | undefined {
    return (def as any).typeName as ZodFirstPartyTypeKind | undefined
  }

  #toArrayItemJsonSchema(required: boolean, schema: Exclude<JSONSchema, boolean>, strategy: 'input' | 'output'): Exclude<JSONSchema, boolean> {
    if (required) {
      return schema
    }

    return strategy === 'input'
      ? { anyOf: [schema, this.unsupportedJsonSchema] }
      : { anyOf: [schema, { type: 'null' }] }
  }
}
