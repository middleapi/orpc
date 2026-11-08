import type { JsonSchema } from '@orpc/json-schema'
import { JsonSchemaFormat, JsonSchemaXNativeType } from '@orpc/json-schema'
import { stringifyJSON } from '@orpc/shared'
import { SyntaxKind } from 'typescript/unstable/ast'
import type {
  Checker,
  Program,
  Symbol as TSSymbol,
  TemplateLiteralType,
  Type,
  TypeReference,
} from 'typescript/unstable/sync'
import {
  ElementFlags,
  ObjectFlags,
  SignatureKind,
  SymbolFlags,
  TypeFlags,
} from 'typescript/unstable/sync'

import { createLibraryPathChecker, getJSDoc } from './utils.ts'

type ObjectJsonSchema = Exclude<JsonSchema, boolean>

/**
 * A type the converter cannot resolve, such as an unresolved import.
 */
export class TypeScriptTypeResolutionError extends TypeError {}

export interface TypeToJsonSchemaConverterOptions {
  /**
   * Which named types become `$defs` (and so OpenAPI components).
   *
   * - `named`: interfaces, classes, enums, and type aliases declared outside `node_modules` and the default library.
   * - `recursive`: only types that reference themselves, which can not be inlined.
   *
   * @default 'named'
   */
  defs?: 'named' | 'recursive' | undefined
}

export interface AsyncIteratorTypes {
  yieldType: Type
  returnType: Type
}

interface Frame {
  deps: Set<string>
}

interface Def extends Frame {
  name: string
  schema?: JsonSchema
}

const DEFS_REF_PREFIX = '#/$defs/'

const NON_NULLISH_LITERAL_FLAGS =
  TypeFlags.StringLiteral | TypeFlags.NumberLiteral | TypeFlags.BooleanLiteral

const NULLISH_FLAGS = TypeFlags.Undefined | TypeFlags.Void | TypeFlags.Null

const PRIMITIVE_FLAGS =
  TypeFlags.StringLike |
  TypeFlags.NumberLike |
  TypeFlags.BigIntLike |
  TypeFlags.BooleanLike |
  TypeFlags.ESSymbolLike

const INSTANTIABLE_FLAGS =
  TypeFlags.TypeParameter |
  TypeFlags.IndexedAccess |
  TypeFlags.Conditional |
  TypeFlags.Substitution |
  TypeFlags.Index

const NAMEABLE_SYMBOL_FLAGS =
  SymbolFlags.Interface | SymbolFlags.Class | SymbolFlags.Enum | SymbolFlags.TypeAlias

/**
 * JSON Schema keywords that can be set through JSDoc tags of the same name, e.g. `@minimum 0`.
 */
const JSDOC_KEYWORD_TAGS = new Set([
  'title',
  'default',
  'format',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'contentMediaType',
  'contentEncoding',
  'readOnly',
  'writeOnly',
])

const JSON_SCHEMA_TYPES = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
  'null',
])

/**
 * Converts TypeScript types into JSON Schemas (draft 2020-12), describing values
 * as they look after oRPC's OpenAPI JSON serialization, e.g. `Date` as a `date-time` string.
 *
 * Named types are emitted as `$defs`. Conversions share a cache, so reuse one converter per program.
 *
 * @see {@link https://orpc.dev/docs/openapi/type-inference#converting-types-directly | OpenAPI Type Inference - Converting Types Directly}
 */
export class TypeToJsonSchemaConverter {
  private readonly defsMode: 'named' | 'recursive'
  private readonly defs = new Map<number, Def>()
  private readonly inlined = new Map<number, JsonSchema>()
  private readonly defsByName = new Map<string, Def>()
  private readonly visiting = new Set<number>()
  private readonly frames: Frame[] = []
  private readonly isLibraryPath: (path: string) => boolean

  constructor(
    private readonly checker: Checker,
    program: Program,
    options: TypeToJsonSchemaConverterOptions = {},
  ) {
    this.defsMode = options.defs ?? 'named'
    this.isLibraryPath = createLibraryPathChecker(program)
  }

  /**
   * Converts a type, returning its schema, with the `$defs` it references, and whether it accepts `undefined`.
   */
  convert(type: Type): [jsonSchema: JsonSchema, optional: boolean] {
    const optional = this.isOptional(type)

    const frame: Frame = { deps: new Set() }
    this.frames.push(frame)

    let schema: JsonSchema
    try {
      schema = type.flags & (TypeFlags.Undefined | TypeFlags.Void) ? {} : this.visit(type)
    } finally {
      this.frames.pop()
    }

    const names = this.collectDeps(frame.deps)

    if (!names.size) {
      return [schema, optional]
    }

    const $defs: Record<string, JsonSchema> = {}
    for (const name of names) {
      $defs[name] = this.defsByName.get(name)!.schema!
    }

    return [{ ...(typeof schema === 'object' ? schema : { not: {} }), $defs }, optional]
  }

  /**
   * Returns the yield and return types when the type is an async iterable, such as an `AsyncGenerator`.
   */
  getAsyncIteratorTypes(type: Type): AsyncIteratorTypes | undefined {
    if (!(type.flags & TypeFlags.Object)) {
      return undefined
    }

    const asyncIteratorProperty = this.checker
      .getPropertiesOfType(type)
      .find((p) => p.name.startsWith('__@asyncIterator@'))

    if (!asyncIteratorProperty) {
      return undefined
    }

    const iterator = this.getCallReturnType(this.checker.getTypeOfSymbol(asyncIteratorProperty))
    const next = iterator && this.checker.getPropertyOfType(iterator, 'next')
    const promise = next && this.getCallReturnType(this.checker.getTypeOfSymbol(next))
    const result = promise && this.getPromisedType(promise)

    if (!result) {
      return undefined
    }

    let yieldType: Type | undefined
    let returnType: Type | undefined

    for (const member of result.isUnionType() ? result.getTypes() : [result]) {
      const done = this.getPropertyType(member, 'done')
      const value = this.getPropertyType(member, 'value')

      if (!done || !value) {
        continue
      }

      if (done.flags & TypeFlags.BooleanLiteral && (done as any).value === true) {
        returnType = value
      } else {
        yieldType = value
      }
    }

    if (!yieldType) {
      return undefined
    }

    return { yieldType, returnType: returnType ?? this.checker.getVoidType() }
  }

  /**
   * Whether the value can be `undefined`, i.e. omitted.
   */
  isOptional(type: Type): boolean {
    if (type.flags & (TypeFlags.Undefined | TypeFlags.Void | TypeFlags.Any | TypeFlags.Unknown)) {
      return true
    }

    return (
      type.isUnionType() &&
      type.getTypes().some((t) => t.flags & (TypeFlags.Undefined | TypeFlags.Void))
    )
  }

  private visit(type: Type): JsonSchema {
    const inlined = this.inlined.get(type.id)

    if (inlined !== undefined) {
      return structuredClone(inlined)
    }

    const existing = this.defs.get(type.id)

    if (existing) {
      this.useDef(existing)
      return { $ref: toRef(existing.name) }
    }

    if (type.isErrorType()) {
      throw new TypeScriptTypeResolutionError(
        `Could not resolve the type "${this.checker.typeToString(type)}". Check its import, and the tsconfig "paths" for aliases like "@/".`,
      )
    }

    if (!(type.flags & (TypeFlags.Object | TypeFlags.UnionOrIntersection))) {
      return this.convertType(type)
    }

    const name = this.defsMode === 'named' ? this.getDefName(type) : undefined

    if (name !== undefined) {
      const def = this.createDef(type, name)
      const schema = this.withFrame(def, () =>
        this.annotate(this.convertType(type), this.getNamedSymbol(type)),
      )

      // a named primitive, like `type UserId = string & { __brand: 'UserId' }`, is clearer inline.
      // It has no refs, so nothing references the def yet.
      if (isTrivialSchema(schema)) {
        this.defs.delete(type.id)
        this.defsByName.delete(def.name)
        this.inlined.set(type.id, schema)
        return structuredClone(schema)
      }

      def.schema = schema
      this.useDef(def)
      return { $ref: toRef(def.name) }
    }

    if (this.visiting.has(type.id)) {
      const def = this.createDef(type, this.getFallbackDefName(type))
      this.useDef(def)
      return { $ref: toRef(def.name) }
    }

    const frame: Frame = { deps: new Set() }
    this.visiting.add(type.id)
    let schema: JsonSchema
    try {
      schema = this.withFrame(frame, () => this.convertType(type))
    } finally {
      this.visiting.delete(type.id)
    }

    // a self reference was found while converting, so the type became a def
    const def = this.defs.get(type.id)

    if (def) {
      for (const dep of frame.deps) {
        def.deps.add(dep)
      }
      def.schema = schema
      this.useDef(def)
      return { $ref: toRef(def.name) }
    }

    for (const dep of frame.deps) {
      this.useDep(dep)
    }

    return schema
  }

  private convertType(type: Type): JsonSchema {
    const flags = type.flags

    if (flags & (TypeFlags.Any | TypeFlags.Unknown | TypeFlags.Undefined | TypeFlags.Void)) {
      return {}
    }

    if (flags & TypeFlags.Never) {
      return { not: {} }
    }

    if (flags & TypeFlags.Null) {
      return { type: 'null' }
    }

    if (flags & TypeFlags.Boolean) {
      return { type: 'boolean' }
    }

    if (flags & TypeFlags.BooleanLiteral) {
      return { type: 'boolean', const: (type as any).value }
    }

    if (flags & TypeFlags.StringLiteral) {
      return { type: 'string', const: (type as any).value }
    }

    if (flags & TypeFlags.NumberLiteral) {
      return { type: 'number', const: (type as any).value }
    }

    if (flags & TypeFlags.BigIntLiteral) {
      return { ...bigintSchema(), const: String((type as any).value) }
    }

    if (flags & TypeFlags.String) {
      return { type: 'string' }
    }

    if (flags & TypeFlags.Number) {
      return { type: 'number' }
    }

    if (flags & TypeFlags.BigInt) {
      return bigintSchema()
    }

    if (flags & TypeFlags.TemplateLiteral) {
      return {
        type: 'string',
        pattern: `^${this.toPattern(type)}$`,
      }
    }

    if (flags & TypeFlags.StringMapping) {
      return { type: 'string' }
    }

    if (flags & TypeFlags.NonPrimitive) {
      return { type: 'object' }
    }

    if (type.isUnionType()) {
      const members = type.getTypes()

      // strip nullish members through the checker, so a named union keeps its name (`Status | null`)
      if (members.some((m) => m.flags & NULLISH_FLAGS)) {
        const core = this.checker.getNonNullableType(type)
        const schema = !core || core.flags & TypeFlags.Never ? undefined : this.visit(core)

        if (!members.some((m) => m.flags & TypeFlags.Null)) {
          return schema ?? {}
        }

        return schema === undefined ? { type: 'null' } : withNull(schema)
      }

      return this.convertUnion(members)
    }

    if (type.isIntersectionType()) {
      return this.convertIntersection(type, type.getTypes())
    }

    if (flags & TypeFlags.Object) {
      return this.convertObject(type)
    }

    if (flags & INSTANTIABLE_FLAGS) {
      const constraint = this.checker.getBaseConstraintOfType(type)

      if (constraint && constraint.id !== type.id) {
        return this.visit(constraint)
      }
    }

    return {}
  }

  private convertUnion(members: readonly Type[]): JsonSchema {
    const strings: string[] = []
    const numbers: number[] = []
    const booleans = new Set<boolean>()
    const schemas: JsonSchema[] = []

    for (const member of members) {
      const flags = member.flags

      if (flags & NULLISH_FLAGS) {
        continue
      }

      if (flags & NON_NULLISH_LITERAL_FLAGS && !this.defs.has(member.id)) {
        const value = (member as any).value
        if (flags & TypeFlags.StringLiteral) {
          strings.push(value)
        } else if (flags & TypeFlags.NumberLiteral) {
          numbers.push(value)
        } else {
          booleans.add(value)
        }
        continue
      }

      schemas.push(this.visit(member))
    }

    const hasPlainString = schemas.some((s) => typeof s === 'object' && isPlain(s, 'string'))
    const hasPlainNumber = schemas.some((s) => typeof s === 'object' && isPlain(s, 'number'))

    const literalSchemas: JsonSchema[] = []

    if (strings.length && !hasPlainString) {
      literalSchemas.push(
        strings.length === 1
          ? { type: 'string', const: strings[0] }
          : { type: 'string', enum: strings },
      )
    }

    if (numbers.length && !hasPlainNumber) {
      literalSchemas.push(
        numbers.length === 1
          ? { type: 'number', const: numbers[0] }
          : { type: 'number', enum: numbers },
      )
    }

    if (booleans.size === 2) {
      literalSchemas.push({ type: 'boolean' })
    } else if (booleans.size === 1) {
      literalSchemas.push({ type: 'boolean', const: [...booleans][0] })
    }

    const anyOf = dedupe([...literalSchemas, ...schemas])

    if (anyOf.length === 0) {
      return { not: {} }
    }

    return anyOf.length === 1 ? anyOf[0]! : { anyOf }
  }

  private convertIntersection(type: Type, members: readonly Type[]): JsonSchema {
    // branded primitives, e.g. `string & { __brand: 'UserId' }`
    const primitive = members.find((m) => m.flags & PRIMITIVE_FLAGS)
    if (primitive) {
      return this.visit(primitive)
    }

    const arrayLike = members.find((m) => this.isArrayOrTuple(m))
    if (arrayLike) {
      return this.visit(arrayLike)
    }

    return this.convertObject(type)
  }

  private convertObject(type: Type): JsonSchema {
    if (isTypeReference(type) && this.checker.isArrayType(type)) {
      const [item] = this.checker.getTypeArguments(type as TypeReference)
      return { type: 'array', items: item ? this.visitElement(item) : {} }
    }

    if (isTypeReference(type) && this.checker.isTupleType(type)) {
      return this.convertTuple(type as TypeReference)
    }

    const builtin = this.convertBuiltinObject(type)
    if (builtin !== undefined) {
      return builtin
    }

    const properties = this.checker.getPropertiesOfType(type)

    const toJSON = properties.find((p) => p.name === 'toJSON')
    if (toJSON) {
      const returnType = this.getCallReturnType(this.checker.getTypeOfSymbol(toJSON))
      if (returnType) {
        return this.visit(returnType)
      }
    }

    const dataProperties = properties.filter(
      (p) =>
        !(p.flags & (SymbolFlags.Method | SymbolFlags.Prototype)) &&
        !p.name.startsWith('__@') &&
        !p.name.startsWith('#') &&
        !p.name.startsWith('__#') &&
        !isClassAccessor(p),
    )

    if (
      dataProperties.length === 0 &&
      this.checker.getSignaturesOfType(type, SignatureKind.Call).length
    ) {
      // functions are not serializable
      return {}
    }

    const schema: ObjectJsonSchema & { properties: Record<string, JsonSchema> } = {
      type: 'object',
      properties: {},
    }
    const required: string[] = []

    const propertyTypes = dataProperties.length ? this.checker.getTypeOfSymbol(dataProperties) : []

    for (let i = 0; i < dataProperties.length; i++) {
      const property = dataProperties[i]!
      const propertyType = propertyTypes[i]

      if (!propertyType || this.isNonSerializable(propertyType)) {
        continue
      }

      // a property that is always `undefined` is dropped by JSON serialization
      if (propertyType.flags & (TypeFlags.Undefined | TypeFlags.Void)) {
        continue
      }

      schema.properties[property.name] = this.annotate(this.visit(propertyType), property)

      if (!(property.flags & SymbolFlags.Optional) && !this.isOptional(propertyType)) {
        required.push(property.name)
      }
    }

    if (required.length) {
      schema.required = required
    }

    for (const info of this.checker.getIndexInfosOfType(type)) {
      const keyFlags = info.keyType.flags
      const valueSchema = this.visit(info.valueType)

      if (keyFlags & (TypeFlags.String | TypeFlags.Number)) {
        schema.additionalProperties ??= valueSchema
      } else if (keyFlags & (TypeFlags.TemplateLiteral | TypeFlags.StringMapping)) {
        schema.patternProperties ??= {}
        schema.patternProperties[`^${this.toPattern(info.keyType)}$`] = valueSchema
      }
    }

    if (!Object.keys(schema.properties).length) {
      delete (schema as ObjectJsonSchema).properties
    }

    return schema
  }

  private convertTuple(type: TypeReference): JsonSchema {
    const target = type.getTarget() as Type & { elementFlags?: readonly ElementFlags[] }
    const elementFlags = target.elementFlags ?? []
    const elements = this.checker.getTypeArguments(type).slice(0, elementFlags.length)

    const prefixItems: JsonSchema[] = []
    let items: JsonSchema | undefined
    let minItems = 0

    for (let i = 0; i < elements.length; i++) {
      const element = elements[i]!
      const flags = elementFlags[i]!

      if (flags & ElementFlags.Variable) {
        items = flags & ElementFlags.Rest ? this.visitElement(element) : {}
        break
      }

      if (flags & ElementFlags.Required) {
        minItems = i + 1
        prefixItems.push(this.visitElement(element))
      } else {
        prefixItems.push(this.visit(element))
      }
    }

    const schema: ObjectJsonSchema = { type: 'array' }

    if (prefixItems.length) {
      schema.prefixItems = prefixItems
    }

    if (items !== undefined) {
      schema.items = items
    } else {
      schema.maxItems = prefixItems.length
    }

    if (minItems) {
      schema.minItems = minItems
    }

    return schema
  }

  private convertBuiltinObject(type: Type): JsonSchema | undefined {
    const symbol = type.getSymbol()

    if (!symbol || !this.isLibrarySymbol(symbol)) {
      return undefined
    }

    switch (symbol.name) {
      case 'Date':
        return {
          'type': 'string',
          'format': JsonSchemaFormat.DateTime,
          'x-native-type': JsonSchemaXNativeType.Date,
        }
      case 'URL':
        return {
          'type': 'string',
          'format': JsonSchemaFormat.URI,
          'x-native-type': JsonSchemaXNativeType.Url,
        }
      case 'Blob':
      case 'File':
        return { type: 'string', contentMediaType: '*/*' }
      case 'Set':
      case 'ReadonlySet': {
        const [item] = this.checker.getTypeArguments(type as TypeReference)
        return {
          'type': 'array',
          'uniqueItems': true,
          'items': item ? this.visitElement(item) : {},
          'x-native-type': JsonSchemaXNativeType.Set,
        }
      }
      case 'Map':
      case 'ReadonlyMap': {
        const [key, value] = this.checker.getTypeArguments(type as TypeReference)
        return {
          'type': 'array',
          'items': {
            type: 'array',
            prefixItems: [key ? this.visitElement(key) : {}, value ? this.visitElement(value) : {}],
            maxItems: 2,
            minItems: 2,
          },
          'x-native-type': JsonSchemaXNativeType.Map,
        }
      }
      case 'Promise':
      case 'PromiseLike': {
        const [value] = this.checker.getTypeArguments(type as TypeReference)
        return value ? this.visit(value) : {}
      }
      case 'RegExp':
      case 'Function':
        return {}
    }

    return undefined
  }

  /**
   * Array items and tuple elements serialize `undefined` as `null`.
   */
  private visitElement(type: Type): JsonSchema {
    if (type.flags & (TypeFlags.Undefined | TypeFlags.Void)) {
      return { type: 'null' }
    }

    const schema = this.visit(type)

    if (
      type.isUnionType() &&
      type.getTypes().some((t) => t.flags & (TypeFlags.Undefined | TypeFlags.Void)) &&
      !type.getTypes().some((t) => t.flags & TypeFlags.Null)
    ) {
      return withNull(schema)
    }

    return schema
  }

  private toPattern(type: Type): string {
    const flags = type.flags

    if (flags & TypeFlags.StringLiteral || flags & TypeFlags.NumberLiteral) {
      return escapeRegExp(String((type as any).value))
    }

    if (flags & TypeFlags.BigIntLiteral) {
      return escapeRegExp(String((type as any).value))
    }

    if (flags & TypeFlags.BooleanLiteral) {
      return String((type as any).value)
    }

    if (flags & TypeFlags.Boolean) {
      return '(?:true|false)'
    }

    if (flags & TypeFlags.Number) {
      return '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?'
    }

    if (flags & TypeFlags.BigInt) {
      return '-?\\d+'
    }

    if (flags & TypeFlags.Null) {
      return 'null'
    }

    if (flags & TypeFlags.Undefined) {
      return 'undefined'
    }

    if (flags & TypeFlags.TemplateLiteral) {
      const template = type as TemplateLiteralType
      const types = template.getTypes()
      let pattern = escapeRegExp(template.texts[0] ?? '')
      for (let i = 0; i < types.length; i++) {
        pattern += this.toPattern(types[i]!) + escapeRegExp(template.texts[i + 1] ?? '')
      }
      return pattern
    }

    if (type.isUnionType()) {
      return `(?:${type
        .getTypes()
        .map((t) => this.toPattern(t))
        .join('|')})`
    }

    if (type.isIntersectionType()) {
      const primitive = type.getTypes().find((m) => m.flags & PRIMITIVE_FLAGS)
      if (primitive) {
        return this.toPattern(primitive)
      }
    }

    return '.*'
  }

  /**
   * Applies the JSDoc of a symbol: the comment becomes `description`,
   * `@deprecated` sets `deprecated`, `@example` adds `examples`,
   * and tags named like JSON Schema keywords (`@minimum 1`, `@format email`) set that keyword.
   */
  private annotate(schema: JsonSchema, symbol: TSSymbol | undefined): JsonSchema {
    if (!symbol || typeof schema !== 'object') {
      return schema
    }

    const jsdoc = getJSDoc(this.checker, symbol, this.isLibraryPath)

    if (!jsdoc) {
      return schema
    }

    const { comment: description, tags } = jsdoc
    const annotated: ObjectJsonSchema = { ...schema }

    if (description) {
      annotated.description = description
    }

    for (const tag of tags) {
      const text = tag.text?.trim() ?? ''

      if (tag.name === 'deprecated') {
        annotated.deprecated = true
      } else if (tag.name === 'example' || tag.name === 'examples') {
        if (text) {
          annotated.examples = [...((annotated.examples as unknown[]) ?? []), parseTagValue(text)]
        }
      } else if (tag.name === 'type' && JSON_SCHEMA_TYPES.has(text)) {
        annotated.type = text as any
      } else if (JSDOC_KEYWORD_TAGS.has(tag.name)) {
        ;(annotated as Record<string, unknown>)[tag.name] = text === '' ? true : parseTagValue(text)
      }
    }

    return annotated
  }

  private getDefName(type: Type): string | undefined {
    const symbol = this.getNamedSymbol(type)

    if (!symbol || this.isLibrarySymbol(symbol)) {
      return undefined
    }

    // unions of literals are named only when they are aliases or enums
    if (type.flags & TypeFlags.Boolean) {
      return undefined
    }

    const text = this.checker.typeToString(type)

    return /^[\w$.]+(?:<[\w$.<>, []+>)?$/u.test(text) && text.length <= 80
      ? text
          .replace(/\[\]/gu, 'Array')
          .replace(/\s*[<,]\s*/gu, '_')
          .replace(/>/gu, '')
      : symbol.name
  }

  private getFallbackDefName(type: Type): string {
    const symbol = type.getAliasSymbol() ?? type.getSymbol()
    const name = symbol?.name

    return name && /^[\w$]+$/u.test(name) && !name.startsWith('__') ? name : 'Recursive'
  }

  private getNamedSymbol(type: Type): TSSymbol | undefined {
    const alias = type.getAliasSymbol()

    if (alias) {
      return alias
    }

    if (type.flags & (TypeFlags.Object | TypeFlags.Union)) {
      const symbol = type.getSymbol()
      if (symbol && symbol.flags & NAMEABLE_SYMBOL_FLAGS) {
        return symbol
      }
    }

    return undefined
  }

  private createDef(type: Type, preferredName: string): Def {
    let name = preferredName
    for (let i = 2; this.defsByName.has(name); i++) {
      name = `${preferredName}${i}`
    }

    const def: Def = { name, deps: new Set() }
    this.defs.set(type.id, def)
    this.defsByName.set(name, def)
    return def
  }

  private useDef(def: Def): void {
    this.useDep(def.name)
  }

  private useDep(name: string): void {
    this.frames.at(-1)?.deps.add(name)
  }

  private withFrame<T>(frame: Frame, fn: () => T): T {
    this.frames.push(frame)
    try {
      return fn()
    } finally {
      this.frames.pop()
    }
  }

  private collectDeps(names: Set<string>): Set<string> {
    const collected = new Set<string>()
    const queue = [...names]

    while (queue.length) {
      const name = queue.pop()!

      if (collected.has(name)) {
        continue
      }

      collected.add(name)
      queue.push(...this.defsByName.get(name)!.deps)
    }

    return collected
  }

  private isLibrarySymbol(symbol: TSSymbol): boolean {
    const path = symbol.declarations[0]?.path
    return path !== undefined && this.isLibraryPath(path)
  }

  private isArrayOrTuple(type: Type): boolean {
    return (
      isTypeReference(type) && (this.checker.isArrayType(type) || this.checker.isTupleType(type))
    )
  }

  private isNonSerializable(type: Type): boolean {
    if (type.flags & TypeFlags.ESSymbolLike) {
      return true
    }

    if (!(type.flags & TypeFlags.Object) || this.isArrayOrTuple(type)) {
      return false
    }

    return (
      this.checker.getSignaturesOfType(type, SignatureKind.Call).length > 0 &&
      this.checker.getPropertiesOfType(type).length === 0
    )
  }

  private getPropertyType(type: Type, name: string): Type | undefined {
    const property = this.checker.getPropertyOfType(type, name)
    return property && this.checker.getTypeOfSymbol(property)
  }

  private getCallReturnType(type: Type | undefined): Type | undefined {
    const signature = type && this.checker.getSignaturesOfType(type, SignatureKind.Call)[0]
    return signature && this.checker.getReturnTypeOfSignature(signature)
  }

  private getPromisedType(type: Type): Type | undefined {
    if (!type.isTypeReference()) {
      return undefined
    }

    return this.checker.getTypeArguments(type)[0]
  }
}

/**
 * Class accessors live on the prototype, so JSON serialization skips them.
 * Accessors of object literals and interfaces describe own data and are kept.
 */
function isClassAccessor(symbol: TSSymbol): boolean {
  if (!(symbol.flags & SymbolFlags.Accessor) || symbol.flags & SymbolFlags.Property) {
    return false
  }

  return symbol.declarations.every((declaration) => {
    const kind = declaration.resolve()?.parent?.kind
    return kind === SyntaxKind.ClassDeclaration || kind === SyntaxKind.ClassExpression
  })
}

/**
 * Arrays and tuples are type references, checking it locally saves compiler requests.
 */
function isTypeReference(type: Type): boolean {
  return Boolean(type.flags & TypeFlags.Object && (type as any).objectFlags & ObjectFlags.Reference)
}

function toRef(name: string): string {
  return `${DEFS_REF_PREFIX}${name.replace(/~/gu, '~0').replace(/\//gu, '~1')}`
}

function bigintSchema(): ObjectJsonSchema {
  return {
    'type': 'string',
    'pattern': '^-?[0-9]+$',
    'x-native-type': JsonSchemaXNativeType.BigInt,
  }
}

function withNull(schema: JsonSchema): JsonSchema {
  if (typeof schema === 'object' && schema.anyOf && Object.keys(schema).length === 1) {
    return { anyOf: dedupe([...schema.anyOf, { type: 'null' }]) }
  }

  return { anyOf: [schema, { type: 'null' }] }
}

const TRIVIAL_KEYWORDS = new Set([
  'type',
  'format',
  'pattern',
  'x-native-type',
  'description',
  'deprecated',
  'examples',
  'default',
])

/**
 * An empty schema, a primitive schema without enums or structure, or a union of them, such as `string | null`.
 */
function isTrivialSchema(schema: JsonSchema): boolean {
  if (typeof schema !== 'object' || Object.keys(schema).length === 0) {
    return true
  }

  if (schema.anyOf && Object.keys(schema).length === 1) {
    return schema.anyOf.every(isTrivialSchema)
  }

  return (
    typeof schema.type === 'string' &&
    schema.type !== 'object' &&
    schema.type !== 'array' &&
    Object.keys(schema).every((key) => TRIVIAL_KEYWORDS.has(key))
  )
}

function isPlain(schema: ObjectJsonSchema, type: string): boolean {
  return schema.type === type && Object.keys(schema).length === 1
}

function dedupe(schemas: JsonSchema[]): JsonSchema[] {
  const seen = new Set<string>()
  return schemas.filter((schema) => {
    const key = stringifyJSON(schema)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&')
}

function parseTagValue(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
