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

export interface TypeToJsonSchemaConvertOptions {
  /**
   * Inline the root def (and the defs of a root union) when nothing else references them,
   * for schemas that are split into parts like path params, query, headers, and body.
   *
   * @default false
   */
  inlineRoot?: boolean | undefined
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
  typeId: number
  schema?: JsonSchema
}

const DEFS_REF_PREFIX = '#/$defs/'

const TYPED_ARRAYS = new Set([
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float16Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
  'Buffer',
])

const MAX_EXPANSION_DEPTH = 32

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
  private readonly expansions = new Map<number, Type[]>()
  private readonly typeArgumentsTexts = new Map<number, string>()
  private createdDefs: Def[] = []
  private truncated = false
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
  convert(
    type: Type,
    options: TypeToJsonSchemaConvertOptions = {},
  ): [jsonSchema: JsonSchema, optional: boolean] {
    const optional = this.isOptional(type)

    const frame: Frame = { deps: new Set() }
    this.frames.push(frame)
    this.createdDefs = []
    this.truncated = false

    let schema: JsonSchema
    let names: Set<string>
    try {
      schema = type.flags & (TypeFlags.Undefined | TypeFlags.Void) ? {} : this.visit(type)
      names = this.collectDeps(frame.deps)
    } catch (error) {
      // defs of a failed conversion may be unfinished or reference unfinished ones
      this.discardCreatedDefs()
      throw error
    } finally {
      this.frames.pop()
    }

    const $defs: Record<string, JsonSchema> = {}
    for (const name of names) {
      $defs[name] = this.defsByName.get(name)!.schema!
    }

    // a cut expansion depends on where the conversion started, so it is not reused
    if (this.truncated) {
      this.discardCreatedDefs()
    }
    this.createdDefs = []

    if (options.inlineRoot) {
      ;[schema, names] = this.inlineRootDefs(schema, names, $defs)
    }

    if (!names.size) {
      return [schema, optional]
    }

    const usedDefs: Record<string, JsonSchema> = {}
    for (const name of names) {
      usedDefs[name] = $defs[name]!
    }

    return [{ ...(typeof schema === 'object' ? schema : { not: {} }), $defs: usedDefs }, optional]
  }

  private discardCreatedDefs(): void {
    for (const def of this.createdDefs) {
      this.defs.delete(def.typeId)
      this.defsByName.delete(def.name)
    }
    this.createdDefs = []
  }

  /**
   * Inlines the root def, and the defs of a root union, when nothing else references them.
   * Used for schemas that get split into parts, like path params, query, and headers,
   * where the def of the whole would become an unused component.
   */
  private inlineRootDefs(
    schema: JsonSchema,
    names: Set<string>,
    $defs: Record<string, JsonSchema>,
  ): [JsonSchema, Set<string>] {
    const referencedByDefs = new Set<string>()
    for (const name of names) {
      for (const dep of this.defsByName.get(name)!.deps) {
        referencedByDefs.add(dep)
      }
    }

    const inline = (member: JsonSchema): JsonSchema => {
      const name = typeof member === 'object' ? fromRef(member) : undefined

      if (name === undefined || referencedByDefs.has(name)) {
        return member
      }

      names.delete(name)
      return $defs[name]!
    }

    let inlined = inline(schema)

    if (typeof inlined === 'object' && inlined.anyOf) {
      const refs = inlined.anyOf.map((m) => (typeof m === 'object' ? fromRef(m) : undefined))
      const unique = refs.every((r, i) => r === undefined || refs.indexOf(r) === i)
      if (unique) {
        inlined = { ...inlined, anyOf: inlined.anyOf.map(inline) }
      }
    }

    // inlined defs may be the only users of other defs
    const remaining = this.collectDeps(
      new Set([...names].filter((n) => referencedByDefs.has(n) || refersTo(inlined, n))),
    )

    return [inlined, remaining]
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

    if (
      !(type.flags & (TypeFlags.Object | TypeFlags.UnionOrIntersection)) &&
      !this.getSingleMemberEnum(type)
    ) {
      return this.convertType(type)
    }

    // every instantiation of `type Expand<T> = { next: Expand<T[]> }` is a new type
    const declaration: number = (type as any).aliasSymbol || (type as any).symbol
    const active = declaration ? this.expansions.get(declaration) : undefined

    if (active?.length && this.isExpanding(active, type)) {
      this.truncated = true
      return {}
    }

    if (!declaration) {
      return this.visitStructured(type)
    }

    const stack = active ?? []
    this.expansions.set(declaration, stack)
    stack.push(type)

    try {
      return this.visitStructured(type)
    } finally {
      stack.pop()
    }
  }

  /**
   * Whether a declaration comes back with type arguments that contain the ones it is already
   * being converted with (`Expand<string>` -> `Expand<string[]>`), which never ends.
   * Distinct instantiations (`Maybe<A>` -> `Maybe<B>`) are fine.
   */
  private isExpanding(active: Type[], type: Type): boolean {
    const symbol = type.getAliasSymbol() ?? type.getSymbol()

    // library types (`Array`, `Map`) only nest as deep as the type that uses them
    if (symbol && this.isLibrarySymbol(symbol)) {
      return false
    }

    if (active.length >= MAX_EXPANSION_DEPTH) {
      return true
    }

    const outer = this.getTypeArgumentsText(active.at(-1)!)
    const inner = this.getTypeArgumentsText(type)

    return outer !== '' && inner.length > outer.length && inner.includes(outer)
  }

  private getTypeArgumentsText(type: Type): string {
    let text = this.typeArgumentsTexts.get(type.id)

    if (text === undefined) {
      const args = type.getAliasSymbol()
        ? type.getAliasTypeArguments()
        : type.isTypeReference()
          ? this.checker.getTypeArguments(type)
          : []
      text = args.map((arg) => this.checker.typeToString(arg)).join(', ')
      this.typeArgumentsTexts.set(type.id, text)
    }

    return text
  }

  private visitStructured(type: Type): JsonSchema {
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

    const namedSymbol = this.getNamedSymbol(type)
    if (namedSymbol && !this.isLibrarySymbol(namedSymbol)) {
      schema = this.annotate(schema, namedSymbol)
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

    // includes computed enum members, e.g. `enum E { A = key.length }`
    if (flags & (TypeFlags.NumberLike | TypeFlags.Enum)) {
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
        const schema =
          !core || core.flags & TypeFlags.Never
            ? undefined
            : // without `strictNullChecks` the checker returns the union itself
              core.id === type.id
              ? this.convertUnion(members, true)
              : this.visit(core)

        if (!members.some((m) => m.flags & TypeFlags.Null)) {
          return schema ?? {}
        }

        return schema === undefined ? { type: 'null' } : withNull(schema)
      }

      return this.convertUnion(members)!
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

  private convertUnion(members: readonly Type[], allowEmpty = false): JsonSchema | undefined {
    const strings = new Set<string>()
    const numbers = new Set<number>()
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
          strings.add(value)
        } else if (flags & TypeFlags.NumberLiteral) {
          numbers.add(value)
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

    for (const [values, type, hasPlain] of [
      [[...strings], 'string', hasPlainString],
      [[...numbers], 'number', hasPlainNumber],
    ] as const) {
      if (values.length && !hasPlain) {
        literalSchemas.push(
          values.length === 1 ? { type, const: values[0] } : { type, enum: [...values] },
        )
      }
    }

    if (booleans.size === 2) {
      literalSchemas.push({ type: 'boolean' })
    } else if (booleans.size === 1) {
      literalSchemas.push({ type: 'boolean', const: [...booleans][0] })
    }

    const anyOf = dedupe([...literalSchemas, ...schemas])

    if (anyOf.length === 0) {
      return allowEmpty ? undefined : { not: {} }
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

    // branded built-ins, e.g. `Date & { __brand: 'CreatedAt' }`
    for (const member of members) {
      const builtin =
        member.flags & TypeFlags.Object ? this.convertBuiltinObject(member) : undefined
      if (builtin !== undefined) {
        return builtin
      }
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
    const isClassInstance = Boolean((type.getSymbol()?.flags ?? 0) & SymbolFlags.Class)

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
        // symbol keys (`__@iterator@12`) and #private fields (`__#12@#secret`);
        // quoted keys starting with `__` are escaped with another `_`
        !p.escapedName.startsWith('__@') &&
        !p.escapedName.startsWith('__#') &&
        !isClassAccessor(p) &&
        // members a class inherits from a library class (`Error#message`) are not own enumerable data
        !(isClassInstance && this.isLibraryMember(p)),
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

      // functions, symbols, and always `undefined` values are dropped by JSON serialization
      if (!propertyType || this.isDropped(propertyType)) {
        continue
      }

      let propertySchema = this.visit(propertyType)

      // an alias of a primitive (`type Count = number`) has no trace in the type,
      // so its JSDoc is read through the property's type annotation
      if (isTrivialSchema(propertySchema)) {
        propertySchema = this.annotate(propertySchema, this.getPrimitiveAliasSymbol(property))
      }

      schema.properties[property.name] = this.annotate(propertySchema, property)

      if (!(property.flags & SymbolFlags.Optional) && !this.isOptional(propertyType)) {
        required.push(property.name)
      }
    }

    if (required.length) {
      schema.required = required
    }

    // a string index covers every key, so it describes additionalProperties over a number index
    const allIndexInfos = this.checker.getIndexInfosOfType(type)
    const indexInfos = [
      ...allIndexInfos.filter((info) => info.keyType.flags & TypeFlags.String),
      ...allIndexInfos.filter((info) => !(info.keyType.flags & TypeFlags.String)),
    ]

    for (const info of indexInfos) {
      const keyFlags = info.keyType.flags

      if (keyFlags & (TypeFlags.String | TypeFlags.Number)) {
        schema.additionalProperties ??= this.visit(info.valueType)
      } else if (keyFlags & (TypeFlags.TemplateLiteral | TypeFlags.StringMapping)) {
        schema.patternProperties ??= {}
        schema.patternProperties[`^${this.toPattern(info.keyType)}$`] = this.visit(info.valueType)
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
    // the rest element and everything after it, like `number` and `boolean` in `[string, ...number[], boolean]`
    const variableItems: JsonSchema[] = []
    let minItems = 0

    for (let i = 0; i < elements.length; i++) {
      const element = elements[i]!
      const flags = elementFlags[i]!

      if (variableItems.length || flags & ElementFlags.Variable) {
        // a variadic element is an unresolved generic spread (`...T`)
        variableItems.push(flags & ElementFlags.Variadic ? {} : this.visitElement(element))
        if (flags & ElementFlags.Required) {
          minItems++
        }
        continue
      }

      if (flags & ElementFlags.Required) {
        minItems = i + 1
      }

      // an `undefined` element, even an optional one, is serialized as `null`
      prefixItems.push(this.visitElement(element))
    }

    const items = dedupe(variableItems)

    const schema: ObjectJsonSchema = { type: 'array' }

    if (prefixItems.length) {
      schema.prefixItems = prefixItems
    }

    if (items.length) {
      schema.items = items.length === 1 ? items[0]! : { anyOf: items }
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

    if (!symbol) {
      return undefined
    }

    if (!this.isLibrarySymbol(symbol)) {
      return symbol.flags & SymbolFlags.Class ? this.convertLibrarySubclass(type) : undefined
    }

    if (TYPED_ARRAYS.has(symbol.name)) {
      // serialized like an object with index keys, `{ "0": 1, "1": 2 }`
      return { type: 'object', additionalProperties: { type: 'number' } }
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
      case 'Object':
        return {}
      case 'Error':
      case 'ArrayBuffer':
      case 'SharedArrayBuffer':
      case 'DataView':
        // no own enumerable data
        return { type: 'object' }
    }

    return undefined
  }

  /**
   * A class extending `Map`, `Set`, or `Array` is serialized like its base,
   * the serializer checks with `instanceof` and `Array.isArray`.
   */
  private convertLibrarySubclass(type: Type): JsonSchema | undefined {
    const base = this.getLibraryBaseName(type)

    if (base === 'Array' || base === 'ReadonlyArray') {
      const item = this.checker
        .getIndexInfosOfType(type)
        .find((info) => info.keyType.flags & TypeFlags.Number)?.valueType
      return { type: 'array', items: item ? this.visitElement(item) : {} }
    }

    if (base === 'Set' || base === 'Map') {
      const item = this.getIteratorYieldType(type)
      return base === 'Set'
        ? {
            'type': 'array',
            'uniqueItems': true,
            'items': item ? this.visitElement(item) : {},
            'x-native-type': JsonSchemaXNativeType.Set,
          }
        : {
            'type': 'array',
            'items': item ? this.visit(item) : {},
            'x-native-type': JsonSchemaXNativeType.Map,
          }
    }

    return undefined
  }

  private getLibraryBaseName(type: Type, depth = 0): string | undefined {
    const target = type.isTypeReference() ? type.getTarget() : type

    for (const base of target.getBaseTypes() ?? []) {
      const symbol = base.getSymbol()

      if (symbol && this.isLibrarySymbol(symbol)) {
        return symbol.name
      }

      const name = depth < 16 ? this.getLibraryBaseName(base, depth + 1) : undefined
      if (name) {
        return name
      }
    }

    return undefined
  }

  private getIteratorYieldType(type: Type): Type | undefined {
    const iteratorProperty = this.checker
      .getPropertiesOfType(type)
      .find((p) => p.escapedName.startsWith('__@iterator@'))
    const iterator =
      iteratorProperty && this.getCallReturnType(this.checker.getTypeOfSymbol(iteratorProperty))
    const next = iterator && this.checker.getPropertyOfType(iterator, 'next')
    const result = next && this.getCallReturnType(this.checker.getTypeOfSymbol(next))

    for (const member of result?.isUnionType() ? result.getTypes() : result ? [result] : []) {
      const done = this.getPropertyType(member, 'done')
      if (done && !(done.flags & TypeFlags.BooleanLiteral && (done as any).value === true)) {
        return this.getPropertyType(member, 'value')
      }
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

    // `.` does not match line terminators
    return '[\\s\\S]*'
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
        Object.assign(annotated, overrideType(annotated, text))
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

    if (symbol.flags & SymbolFlags.Enum) {
      return symbol.name
    }

    const text = this.checker.typeToString(type)

    // `Page<User>` -> `Page_User`, `Page<User[]>` -> `Page_UserArray`, `Pair<[A, B]>` -> `Pair_A_B`
    return /^[\w$.]+(?:<[\w$.<>, [\]]+>)?$/u.test(text) && text.length <= 80
      ? text
          .replace(/\[\]/gu, 'Array')
          .replace(/[\s<,[]+/gu, '_')
          .replace(/[>\]]/gu, '')
          .replace(/_+/gu, '_')
          .replace(/_$/u, '')
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

    return this.getSingleMemberEnum(type)
  }

  /**
   * The type of an enum with one member is that member's literal type.
   */
  private getSingleMemberEnum(type: Type): TSSymbol | undefined {
    if (!(type.flags & TypeFlags.EnumLiteral) || type.flags & TypeFlags.Union) {
      return undefined
    }

    const parent = type.getSymbol()?.getParent()

    if (!parent || !(parent.flags & SymbolFlags.Enum)) {
      return undefined
    }

    return this.checker.getDeclaredTypeOfSymbol(parent).id === type.id ? parent : undefined
  }

  private createDef(type: Type, preferredName: string): Def {
    let name = preferredName
    for (let i = 2; this.defsByName.has(name); i++) {
      name = `${preferredName}${i}`
    }

    const def: Def = { name, typeId: type.id, deps: new Set() }
    this.defs.set(type.id, def)
    this.defsByName.set(name, def)
    this.createdDefs.push(def)
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

  private getPrimitiveAliasSymbol(property: TSSymbol): TSSymbol | undefined {
    const declaration = property.declarations[0]

    if (!declaration || this.isLibraryPath(declaration.path)) {
      return undefined
    }

    let typeNode = (declaration.resolve() as any)?.type

    // `count?: Count | null`
    if (typeNode?.kind === SyntaxKind.UnionType) {
      const references = typeNode.types.filter((t: any) => t.kind === SyntaxKind.TypeReference)
      typeNode = references.length === 1 ? references[0] : undefined
    }

    if (typeNode?.kind !== SyntaxKind.TypeReference) {
      return undefined
    }

    let symbol = this.checker.getSymbolAtLocation(typeNode.typeName)

    if (symbol && symbol.flags & SymbolFlags.Alias) {
      symbol = this.checker.getAliasedSymbol(symbol)
    }

    return symbol && symbol.flags & SymbolFlags.TypeAlias && !this.isLibrarySymbol(symbol)
      ? symbol
      : undefined
  }

  private isLibraryMember(symbol: TSSymbol): boolean {
    return (
      symbol.declarations.length > 0 &&
      symbol.declarations.every((declaration) => this.isLibraryPath(declaration.path))
    )
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

  /**
   * Whether JSON serialization drops a property of this type: `undefined`, functions,
   * and symbols, optionally mixed with `undefined` (`cb?: () => void`).
   */
  private isDropped(type: Type): boolean {
    const members = type.isUnionType() ? type.getTypes() : [type]

    return members.every(
      (m) => m.flags & (TypeFlags.Undefined | TypeFlags.Void) || this.isNonSerializable(m),
    )
  }

  private isNonSerializable(type: Type): boolean {
    if (type.flags & TypeFlags.ESSymbolLike) {
      return true
    }

    if (!(type.flags & TypeFlags.Object) || this.isArrayOrTuple(type)) {
      return false
    }

    // functions, also with properties (`{ (): void; displayName: string }`) or as constructors
    const symbol = type.getSymbol()
    if (symbol?.name === 'Function' && this.isLibrarySymbol(symbol)) {
      return true
    }

    return (
      this.checker.getSignaturesOfType(type, SignatureKind.Call).length > 0 ||
      this.checker.getSignaturesOfType(type, SignatureKind.Construct).length > 0
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

function fromRef(schema: ObjectJsonSchema): string | undefined {
  if (typeof schema.$ref !== 'string' || Object.keys(schema).length !== 1) {
    return undefined
  }

  return schema.$ref.startsWith(DEFS_REF_PREFIX)
    ? schema.$ref.slice(DEFS_REF_PREFIX.length).replace(/~1/gu, '/').replace(/~0/gu, '~')
    : undefined
}

function refersTo(schema: JsonSchema, name: string): boolean {
  return (stringifyJSON(schema) ?? '').includes(stringifyJSON(toRef(name))!)
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

/**
 * Sets the `type` of a schema from `@type`, keeping `null` branches (`number | null`)
 * and leaving refs untouched.
 */
function overrideType(schema: ObjectJsonSchema, type: string): ObjectJsonSchema {
  if (schema.$ref !== undefined) {
    return schema
  }

  if (schema.anyOf && schema.type === undefined) {
    return {
      ...schema,
      anyOf: schema.anyOf.map((member) =>
        typeof member === 'object' && member.type !== 'null' ? overrideType(member, type) : member,
      ),
    }
  }

  return { ...schema, type: type as any }
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
