import type { JsonSchema } from '@orpc/json-schema'
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

import type { ObjectJsonSchema } from './schema-utils.ts'
import {
  applyJSDoc,
  bigintSchema,
  collectDefRefs,
  dedupe,
  escapeRegExp,
  fromRef,
  getLeafBuiltinSchema,
  isLiteralSchema,
  isPlain,
  isTrivialSchema,
  mapSchema,
  setSchema,
  toRef,
  withNull,
} from './schema-utils.ts'
import type { JSDoc, SourceKind } from './utils.ts'
import {
  createSourceKindChecker,
  getCallReturnType,
  getIteratorTypes,
  getJSDoc,
  isClassAccessor,
  isTypeReference,
  resolveAlias,
} from './utils.ts'

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
   * Inline the root def (and the defs of a root union) when it is not recursive,
   * for schemas that are split into parts like path params, query, headers, and body,
   * where a def of the whole would become an unused component.
   *
   * @default false
   */
  inlineRoot?: boolean | undefined

  /**
   * With `inlineRoot`, also inline the defs of these root properties,
   * like `params` and `query` of a detailed input, or `status` and `headers` of a detailed output.
   */
  inlineProperties?: readonly string[] | undefined
}

export interface AsyncIteratorTypes {
  yieldType: Type
  returnType: Type
}

interface Def {
  name: string
  typeId: number
  schema?: JsonSchema
  /** The defs the schema refers to, computed once the schema is final */
  deps?: Set<string>
}

interface Expansion {
  type: Type
  /** How many times in a row the type arguments grew */
  growth: number
}

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
])

/** Typings of runtime built-in modules, whose classes are not data holders */
const RUNTIME_TYPINGS = /\/node_modules\/(?:@types\/(?:node|bun|deno)|bun-types)\//u

/** Nested instantiations of one declaration, like `Maybe<A>` inside `Maybe<B>` */
const MAX_NESTING = 16
/** Distinct instantiations of one declaration in one conversion */
const MAX_INSTANTIATIONS = 64
/** Nested instantiations in a row whose type arguments contain the previous ones */
const MAX_GROWTH = 3

const UNDEFINED_FLAGS = TypeFlags.Undefined | TypeFlags.Void

const NULLISH_FLAGS = UNDEFINED_FLAGS | TypeFlags.Null

const LITERAL_FLAGS = TypeFlags.StringLiteral | TypeFlags.NumberLiteral | TypeFlags.BooleanLiteral

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
 * Converts TypeScript types into JSON Schemas (draft 2020-12), describing values
 * as they look after oRPC's OpenAPI JSON serialization, e.g. `Date` as a `date-time` string.
 *
 * Named types are emitted as `$defs`. Conversions share a cache, so reuse one converter per program.
 *
 * @see {@link https://orpc.dev/docs/openapi/type-inference#converting-types-directly | OpenAPI Type Inference - Converting Types Directly}
 */
export class TypeToJsonSchemaConverter {
  private readonly defsMode: 'named' | 'recursive'
  private readonly getSourceKind: (path: string) => SourceKind

  private readonly defs = new Map<number, Def>()
  private readonly defsByName = new Map<string, Def>()
  /** Named types whose schema is clearer inline, like `type UserId = string & { ... }` */
  private readonly inlined = new Map<number, JsonSchema>()

  /** Anonymous types being converted, with the named depth they were entered at */
  private readonly visiting = new Map<number, number>()
  private readonly visitingStack: Type[] = []
  /** Types that close a cycle, preferred over wrappers around them for the def */
  private readonly cycleClosers = new Set<number>()
  /** Non-null cores of named nullable unions, back to the union (`Json` without `null` -> `Json`) */
  private readonly nullableCores = new Map<number, Type>()
  private namedDepth = 0
  private readonly expansions = new Map<number, Expansion[]>()
  private readonly instantiations = new Map<number, Set<number>>()
  private createdDefs: Def[] = []
  private createdInlined: number[] = []
  private truncated = false

  private readonly membersCache = new Map<number, readonly Type[]>()
  private readonly propertiesCache = new Map<number, readonly TSSymbol[]>()
  private readonly typeArgumentsCache = new Map<number, readonly Type[]>()
  private readonly jsdocCache = new Map<number, JSDoc | undefined>()
  private readonly singleMemberEnumCache = new Map<number, TSSymbol | undefined>()

  constructor(
    private readonly checker: Checker,
    program: Program,
    options: TypeToJsonSchemaConverterOptions = {},
  ) {
    this.defsMode = options.defs ?? 'named'
    this.getSourceKind = createSourceKindChecker(program)
  }

  /**
   * Converts a type, returning its schema, with the `$defs` it references, and whether it accepts `undefined`.
   */
  convert(
    type: Type,
    options: TypeToJsonSchemaConvertOptions = {},
  ): [jsonSchema: JsonSchema, optional: boolean] {
    const optional = this.isOptional(type)

    this.createdDefs = []
    this.createdInlined = []
    this.truncated = false
    this.instantiations.clear()

    let schema: JsonSchema
    const $defs: Record<string, JsonSchema> = {}

    try {
      schema = this.visit(type)

      if (options.inlineRoot) {
        schema = this.inlineDefs(schema, options.inlineProperties ?? [])
      }

      for (const name of this.collectDeps(collectDefRefs(schema))) {
        $defs[name] = this.defsByName.get(name)!.schema!
      }
    } catch (error) {
      // defs of a failed conversion may be unfinished or reference unfinished ones
      this.discardCreatedDefs()
      throw error
    }

    // a cut expansion depends on where the conversion started, so it is not reused
    if (this.truncated) {
      this.discardCreatedDefs()
    }
    this.createdDefs = []
    this.createdInlined = []

    if (!Object.keys($defs).length) {
      return [schema, optional]
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

    const types = getIteratorTypes(this.checker, type, this.getProperties(type), true)

    return (
      types && {
        yieldType: types.yieldType,
        returnType: types.returnType ?? this.checker.getVoidType(),
      }
    )
  }

  /**
   * Whether the value can be `undefined`, i.e. omitted.
   */
  isOptional(type: Type): boolean {
    return Boolean(
      type.flags & (UNDEFINED_FLAGS | TypeFlags.Any | TypeFlags.Unknown) ||
      this.hasMember(type, UNDEFINED_FLAGS),
    )
  }

  private visit(type: Type): JsonSchema {
    const inlined = this.inlined.get(type.id)

    if (inlined !== undefined) {
      return structuredClone(inlined)
    }

    const existing = this.defs.get(type.id)

    if (existing) {
      return { $ref: toRef(existing.name) }
    }

    if (type.isErrorType()) {
      throw new TypeScriptTypeResolutionError(
        `Could not resolve the type "${this.checker.typeToString(type)}". Check its import, and the tsconfig "paths" for aliases like "@/".`,
      )
    }

    const singleMemberEnum = this.getSingleMemberEnum(type)

    if (!(type.flags & (TypeFlags.Object | TypeFlags.UnionOrIntersection)) && !singleMemberEnum) {
      return this.convertType(type)
    }

    // every instantiation of `type Expand<T> = { next: Expand<T[]> }` is a new type
    const declaration: number = (type as any).aliasSymbol || (type as any).symbol

    if (!declaration) {
      return this.visitStructured(type, singleMemberEnum)
    }

    const stack = this.expansions.get(declaration) ?? []

    // the same type again (through a named def) is not an expansion, the cycle logic handles it
    if (stack.some((entry) => entry.type.id === type.id)) {
      return this.visitStructured(type, singleMemberEnum)
    }

    const growth = this.getExpansionGrowth(declaration, stack, type)

    if (growth === undefined) {
      this.truncated = true
      return {}
    }

    this.expansions.set(declaration, stack)
    stack.push({ type, growth })

    try {
      return this.visitStructured(type, singleMemberEnum)
    } finally {
      stack.pop()

      // the budget is per outermost instantiation, siblings (`A[]` next to `B[]`) are not nested
      if (!stack.length) {
        this.instantiations.delete(declaration)
      }
    }
  }

  /**
   * Returns how often in a row the type arguments grew, or `undefined` when the expansion
   * should stop: a declaration coming back with type arguments that contain the previous ones
   * (`Expand<string>` -> `Expand<string[]>` -> ...), nesting too deep, or too many instantiations.
   * Distinct instantiations (`Maybe<A>` inside `Maybe<B>`) are fine.
   */
  private getExpansionGrowth(
    declaration: number,
    stack: readonly Expansion[],
    type: Type,
  ): number | undefined {
    const outer = stack.at(-1)

    // not nested in itself, so not an expansion
    if (!outer) {
      return 0
    }

    // default library types (`Array`, `Map`) only nest as deep as the type that uses them
    const symbol = type.getAliasSymbol() ?? type.getSymbol()
    if (symbol && this.getSymbolSourceKind(symbol) === 'default') {
      return 0
    }

    let seen = this.instantiations.get(declaration)

    if (!seen) {
      seen = new Set()
      this.instantiations.set(declaration, seen)
    }

    seen.add(type.id)

    if (stack.length >= MAX_NESTING || seen.size > MAX_INSTANTIATIONS) {
      return undefined
    }

    const growth = this.argumentsGrow(outer.type, type) ? outer.growth + 1 : 0
    return growth >= MAX_GROWTH ? undefined : growth
  }

  private argumentsGrow(outer: Type, inner: Type): boolean {
    const outerArguments = this.getTypeArguments(outer)

    return this.getTypeArguments(inner).some((innerArgument) =>
      outerArguments.some(
        (outerArgument) =>
          innerArgument.id !== outerArgument.id &&
          this.containsType(innerArgument, outerArgument.id, 3),
      ),
    )
  }

  private containsType(type: Type, id: number, depth: number): boolean {
    if (type.id === id) {
      return true
    }

    if (depth === 0) {
      return false
    }

    let children: readonly (Type | undefined)[]

    if (type.flags & TypeFlags.UnionOrIntersection) {
      children = this.getMembers(type)
    } else if (
      type.flags & TypeFlags.Object &&
      (type as any).objectFlags & ObjectFlags.Anonymous &&
      !type.getAliasSymbol()
    ) {
      // `Thread<{ parent: T }>` grows through the literal's properties
      const properties = this.getProperties(type)
      children = properties.length ? this.checker.getTypeOfSymbol(properties) : []
    } else {
      children = this.getTypeArguments(type)
    }

    return children.some((child) => child !== undefined && this.containsType(child, id, depth - 1))
  }

  private visitStructured(type: Type, singleMemberEnum: TSSymbol | undefined): JsonSchema {
    const namedSymbol = singleMemberEnum ?? this.getNamedSymbol(type)
    const projectSymbol =
      namedSymbol && this.getSymbolSourceKind(namedSymbol) === 'project' ? namedSymbol : undefined

    if (this.defsMode === 'named' && projectSymbol && !(type.flags & TypeFlags.Boolean)) {
      const def = this.createDef(type, this.getDefName(type, projectSymbol))

      this.namedDepth++
      let schema: JsonSchema
      try {
        schema = this.annotate(this.convertType(type), projectSymbol)
      } finally {
        this.namedDepth--
      }

      // a named primitive, like `type UserId = string & { __brand: 'UserId' }`, is clearer inline.
      // It has no refs, so nothing references the def yet.
      if (isTrivialSchema(schema)) {
        this.removeDef(def)
        this.inlined.set(type.id, schema)
        this.createdInlined.push(type.id)
        return structuredClone(schema)
      }

      def.schema = schema
      return { $ref: toRef(def.name) }
    }

    const enteredAt = this.visiting.get(type.id)

    // the same anonymous type again, without a named def in between to stop at: a cycle.
    // Through a named def (`Tree[]` in `Tree`), converting it again ends at that def.
    if (enteredAt === this.namedDepth) {
      const closer = this.getCycleCloser(type)

      if (closer === undefined) {
        return { $ref: toRef(this.createDef(type, this.getFallbackDefName(type)).name) }
      }

      // convert this wrapper (`TreeNode[]`) once more, so the cycle closes at `TreeNode` instead
      this.cycleClosers.add(closer.id)
    }

    this.visiting.set(type.id, this.namedDepth)
    this.visitingStack.push(type)

    let schema: JsonSchema
    try {
      schema = this.convertType(type)
    } finally {
      this.visitingStack.pop()
      if (enteredAt === undefined) {
        this.visiting.delete(type.id)
      } else {
        this.visiting.set(type.id, enteredAt)
      }
    }

    if (projectSymbol) {
      schema = this.annotate(schema, projectSymbol)
    }

    // a self reference was found while converting, so the type became a def
    const def = this.defs.get(type.id)

    if (def) {
      def.schema ??= schema
      return { $ref: toRef(def.name) }
    }

    return schema
  }

  /**
   * When a cycle comes back to a type without a good name, like `TreeNode[]` or
   * `Record<string, Dict>`, returns the named type in the cycle (`TreeNode`) to make the def for.
   */
  private getCycleCloser(type: Type): Type | undefined {
    if (this.cycleClosers.has(type.id) || this.hasCycleName(type)) {
      return undefined
    }

    const start = this.visitingStack.findIndex((entry) => entry.id === type.id)

    // converted once more already, the closer did not come back
    if (this.visitingStack.lastIndexOf(type) !== start) {
      return undefined
    }

    return this.visitingStack.slice(start + 1).find((entry) => this.hasCycleName(entry))
  }

  private hasCycleName(type: Type): boolean {
    const symbol = this.getNamedSymbol(type)

    return Boolean(
      symbol && !symbol.name.startsWith('__') && this.getSymbolSourceKind(symbol) !== 'default',
    )
  }

  private convertType(type: Type): JsonSchema {
    const flags = type.flags

    if (flags & (TypeFlags.Any | TypeFlags.Unknown | UNDEFINED_FLAGS)) {
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
      return { type: 'string', pattern: `^${this.toPattern(type)}$` }
    }

    if (flags & TypeFlags.StringMapping) {
      return { type: 'string' }
    }

    if (flags & TypeFlags.NonPrimitive) {
      return { type: 'object' }
    }

    if (type.isUnionType()) {
      return this.convertNullableUnion(type, this.getMembers(type))
    }

    if (type.isIntersectionType()) {
      return this.convertIntersection(type, this.getMembers(type))
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

  /**
   * `undefined` members are left to the caller (optional), `null` adds a `null` branch.
   * The rest is visited as its own type, so a named union keeps its name (`Status | null`).
   */
  private convertNullableUnion(type: Type, members: readonly Type[]): JsonSchema {
    const concrete = members.filter((m) => !(m.flags & NULLISH_FLAGS))

    if (concrete.length === members.length) {
      return this.convertUnion(members) ?? { not: {} }
    }

    let schema: JsonSchema | undefined

    if (concrete.length === 1) {
      schema = this.visit(concrete[0]!)
    } else if (concrete.length > 1) {
      const core = this.checker.getNonNullableType(type)
      const hasNull = members.some((m) => m.flags & TypeFlags.Null)

      // without `strictNullChecks` the checker returns the union itself
      if (core && core.id !== type.id && !(core.flags & TypeFlags.Never)) {
        // `Json | undefined` inside `type Json = ... | null` is `Json` again
        const named = this.nullableCores.get(core.id)
        if (named && named.id !== type.id && hasNull) {
          return this.visit(named)
        }

        if (hasNull && type.getAliasSymbol() && !this.hasMember(type, UNDEFINED_FLAGS)) {
          this.nullableCores.set(core.id, type)
        }

        schema = this.visit(core)
      } else {
        schema = this.convertUnion(concrete)
      }
    }

    if (!members.some((m) => m.flags & TypeFlags.Null)) {
      return schema ?? {}
    }

    return schema === undefined ? { type: 'null' } : withNull(schema)
  }

  private convertUnion(members: readonly Type[]): JsonSchema | undefined {
    const strings = new Set<string>()
    const numbers = new Set<number>()
    const booleans = new Set<boolean>()
    const schemas: JsonSchema[] = []

    for (const member of members) {
      if (member.flags & LITERAL_FLAGS && !this.getSingleMemberEnum(member)) {
        const value = (member as any).value
        if (member.flags & TypeFlags.StringLiteral) {
          strings.add(value)
        } else if (member.flags & TypeFlags.NumberLiteral) {
          numbers.add(value)
        } else {
          booleans.add(value)
        }
      } else if (!(member.flags & NULLISH_FLAGS)) {
        schemas.push(this.visit(member))
      }
    }

    const literals: JsonSchema[] = []

    for (const [values, type] of [
      [strings, 'string'],
      [numbers, 'number'],
    ] as const) {
      // `'a' | (string & {})` is just a string
      if (values.size && !schemas.some((s) => isPlain(s, type))) {
        const [first] = values
        literals.push(values.size === 1 ? { type, const: first } : { type, enum: [...values] })
      }
    }

    if (booleans.size) {
      const [first] = booleans
      literals.push(booleans.size === 2 ? { type: 'boolean' } : { type: 'boolean', const: first })
    }

    const anyOf = dedupe([...literals, ...schemas])

    if (anyOf.length === 0) {
      return undefined
    }

    return anyOf.length === 1 ? anyOf[0]! : { anyOf }
  }

  private convertIntersection(type: Type, members: readonly Type[]): JsonSchema {
    // branded primitives, e.g. `string & { __brand: 'UserId' }`
    const primitive = members.find((m) => m.flags & PRIMITIVE_FLAGS)
    if (primitive) {
      return this.visit(primitive)
    }

    const arrayLike = members.find((m) => this.getReferenceKind(m) !== undefined)
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
    const referenceKind = this.getReferenceKind(type)

    if (referenceKind === 'array') {
      return { type: 'array', items: this.visitElement(this.getReferenceArguments(type)[0]) }
    }

    if (referenceKind === 'tuple') {
      return this.convertTuple(type as TypeReference)
    }

    const builtin = this.convertBuiltinObject(type)
    if (builtin !== undefined) {
      return builtin
    }

    const properties = this.getProperties(type)

    // the serializer walks plain objects key by key, only other objects go through `toJSON`
    const toJSON = this.isObjectLiteral(type)
      ? undefined
      : properties.find((p) => p.name === 'toJSON')
    if (toJSON) {
      const returnType = getCallReturnType(this.checker, this.checker.getTypeOfSymbol(toJSON))
      if (returnType) {
        return this.visit(returnType)
      }
    }

    const isClassInstance = Boolean((type.getSymbol()?.flags ?? 0) & SymbolFlags.Class)
    // members of `Error` subclasses from packages are not data either (`ZodError#issues` is a getter)
    const isError = isClassInstance && this.getBuiltinBaseName(type) === 'Error'

    const dataProperties = properties.filter(
      (p) =>
        !(p.flags & (SymbolFlags.Method | SymbolFlags.Prototype)) &&
        // symbol keys (`__@iterator@12`) and #private fields (`__#12@#secret`);
        // quoted keys starting with `__` are escaped with another `_`
        !p.escapedName.startsWith('__@') &&
        !p.escapedName.startsWith('__#') &&
        !isClassAccessor(p) &&
        // members inherited from a built-in class (`Error#message`, `Readable#readable`) are not own enumerable data
        !(isClassInstance && this.isBuiltinMember(p, isError)),
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

      let propertySchema = this.visit(
        this.getNullableAliasType(property, propertyType) ?? propertyType,
      )

      // an alias of a primitive or literal (`type Count = number`) leaves no trace in the type,
      // so its JSDoc is read through the property's type annotation
      if (isTrivialSchema(propertySchema) || isLiteralSchema(propertySchema)) {
        propertySchema = this.annotate(propertySchema, this.getAnnotationAlias(property))
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
    const indexInfos = this.checker.getIndexInfosOfType(type)

    for (const info of [
      ...indexInfos.filter((info) => info.keyType.flags & TypeFlags.String),
      ...indexInfos.filter((info) => !(info.keyType.flags & TypeFlags.String)),
    ]) {
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
    const elements = this.getReferenceArguments(type).slice(0, elementFlags.length)

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

    // only globals of the default library, a `File` or `Map` class of a package is its own type
    if (this.getSymbolSourceKind(symbol) !== 'default') {
      return symbol.flags & SymbolFlags.Class ? this.convertBuiltinSubclass(type) : undefined
    }

    const leaf = getLeafBuiltinSchema(symbol.name)
    if (leaf) {
      return leaf
    }

    if (TYPED_ARRAYS.has(symbol.name)) {
      // serialized like an object with index keys, `{ "0": 1, "1": 2 }`
      return { type: 'object', additionalProperties: { type: 'number' } }
    }

    const [first, second] = this.getReferenceArguments(type)

    switch (symbol.name) {
      case 'Set':
      case 'ReadonlySet':
        return setSchema(this.visitElement(first))
      case 'Map':
      case 'ReadonlyMap':
        return mapSchema({
          type: 'array',
          prefixItems: [this.visitElement(first), this.visitElement(second)],
          maxItems: 2,
          minItems: 2,
        })
      case 'Promise':
      case 'PromiseLike':
        return first ? this.visit(first) : {}
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
   * A class extending a built-in, like `Map`, `Set`, `Array`, or `Date`, is serialized like it,
   * the serializer checks with `instanceof` and `Array.isArray`.
   */
  private convertBuiltinSubclass(type: Type): JsonSchema | undefined {
    const base = this.getBuiltinBaseName(type)

    if (base === undefined) {
      return undefined
    }

    if (base === 'Array' || base === 'ReadonlyArray') {
      const item = this.checker
        .getIndexInfosOfType(type)
        .find((info) => info.keyType.flags & TypeFlags.Number)?.valueType
      return { type: 'array', items: this.visitElement(item) }
    }

    if (base === 'Set' || base === 'Map') {
      const item = getIteratorTypes(this.checker, type, this.getProperties(type), false)?.yieldType
      return base === 'Set'
        ? setSchema(this.visitElement(item))
        : mapSchema(item ? this.visit(item) : {})
    }

    return getLeafBuiltinSchema(base)
  }

  private getBuiltinBaseName(type: Type, depth = 0): string | undefined {
    const target = type.isTypeReference() ? type.getTarget() : type

    for (const base of target.getBaseTypes() ?? []) {
      const symbol = base.getSymbol()

      if (symbol && this.getSymbolSourceKind(symbol) === 'default') {
        return symbol.name
      }

      const name = depth < 16 ? this.getBuiltinBaseName(base, depth + 1) : undefined
      if (name) {
        return name
      }
    }

    return undefined
  }

  /**
   * Array items and tuple elements serialize `undefined` as `null`.
   */
  private visitElement(type: Type | undefined): JsonSchema {
    if (!type) {
      return {}
    }

    if (type.flags & UNDEFINED_FLAGS) {
      return { type: 'null' }
    }

    const schema = this.visit(type)

    return this.hasMember(type, UNDEFINED_FLAGS) && !this.hasMember(type, TypeFlags.Null)
      ? withNull(schema)
      : schema
  }

  private toPattern(type: Type): string {
    const flags = type.flags

    if (flags & (TypeFlags.StringLiteral | TypeFlags.NumberLiteral | TypeFlags.BigIntLiteral)) {
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
      const types = this.getMembers(template)
      let pattern = escapeRegExp(template.texts[0] ?? '')
      for (let i = 0; i < types.length; i++) {
        pattern += this.toPattern(types[i]!) + escapeRegExp(template.texts[i + 1] ?? '')
      }
      return pattern
    }

    if (type.isUnionType()) {
      return `(?:${this.getMembers(type)
        .map((t) => this.toPattern(t))
        .join('|')})`
    }

    if (type.isIntersectionType()) {
      const primitive = this.getMembers(type).find((m) => m.flags & PRIMITIVE_FLAGS)
      if (primitive) {
        return this.toPattern(primitive)
      }
    }

    // `.` does not match line terminators
    return '[\\s\\S]*'
  }

  /**
   * Inlines the root def, the defs of a root union, and the defs of `properties` of the root
   * (or of each root union member), unless they are recursive.
   */
  private inlineDefs(schema: JsonSchema, properties: readonly string[]): JsonSchema {
    const inlineRef = (member: JsonSchema): JsonSchema => {
      const name = fromRef(member)
      const def = name === undefined ? undefined : this.defsByName.get(name)

      if (!def || this.collectDeps(this.getDefDeps(def)).has(def.name)) {
        return member
      }

      return def.schema!
    }

    const inlineProperties = (member: JsonSchema): JsonSchema => {
      const inlined = inlineRef(member)

      if (typeof inlined !== 'object' || !inlined.properties || !properties.length) {
        return inlined
      }

      const inlinedProperties = { ...inlined.properties }
      for (const property of properties) {
        if (inlinedProperties[property] !== undefined) {
          inlinedProperties[property] = inlineRef(inlinedProperties[property])
        }
      }

      return { ...inlined, properties: inlinedProperties }
    }

    const root = inlineProperties(schema)

    if (typeof root === 'object' && root.anyOf) {
      return { ...root, anyOf: root.anyOf.map(inlineProperties) }
    }

    return root
  }

  private annotate(schema: JsonSchema, symbol: TSSymbol | undefined): JsonSchema {
    if (!symbol || typeof schema !== 'object') {
      return schema
    }

    if (!this.jsdocCache.has(symbol.id)) {
      this.jsdocCache.set(symbol.id, getJSDoc(this.checker, symbol, this.getSourceKind))
    }

    const jsdoc = this.jsdocCache.get(symbol.id)

    return jsdoc ? applyJSDoc(schema, jsdoc.comment, jsdoc.tags) : schema
  }

  private getDefName(type: Type, symbol: TSSymbol): string {
    // internal names like `__class` (class expressions) are not used
    const internal = symbol.name.startsWith('__')

    if (!internal && (symbol.flags & SymbolFlags.Enum || !this.getTypeArguments(type).length)) {
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
      : internal
        ? this.getFallbackDefName(type)
        : symbol.name
  }

  private getFallbackDefName(type: Type): string {
    const name = (type.getAliasSymbol() ?? type.getSymbol())?.name

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

  /**
   * The type of an enum with one member is that member's literal type.
   */
  private getSingleMemberEnum(type: Type): TSSymbol | undefined {
    if (!(type.flags & TypeFlags.EnumLiteral) || type.flags & TypeFlags.Union) {
      return undefined
    }

    if (!this.singleMemberEnumCache.has(type.id)) {
      const parent = type.getSymbol()?.getParent()
      const isSingle =
        parent &&
        parent.flags & SymbolFlags.Enum &&
        this.checker.getDeclaredTypeOfSymbol(parent).id === type.id
      this.singleMemberEnumCache.set(type.id, isSingle ? parent : undefined)
    }

    return this.singleMemberEnumCache.get(type.id)
  }

  /**
   * The alias of a property's type annotation (`count: Count`), when it names a project type alias.
   */
  /**
   * `status?: Status` with `type Status = 'open' | null` has the type `'open' | null | undefined`,
   * which no longer carries the alias, and stripping `undefined` through the checker also strips
   * `null`. The declared alias type keeps the def and its JSDoc.
   */
  private getNullableAliasType(property: TSSymbol, type: Type): Type | undefined {
    if (!this.hasMember(type, UNDEFINED_FLAGS) || !this.hasMember(type, TypeFlags.Null)) {
      return undefined
    }

    const alias = this.getAnnotationAlias(property)
    const declared = alias && this.checker.getDeclaredTypeOfSymbol(alias)

    return declared && this.hasMember(declared, TypeFlags.Null) && !this.isOptional(declared)
      ? declared
      : undefined
  }

  /**
   * The project type alias a property's type annotation names, like `Count` in `count?: Count | null`.
   */
  private getAnnotationAlias(property: TSSymbol): TSSymbol | undefined {
    const declaration = property.declarations[0]

    if (!declaration || this.getSourceKind(declaration.path) !== 'project') {
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

    const symbol = this.checker.getSymbolAtLocation(typeNode.typeName)
    const target = symbol && resolveAlias(this.checker, symbol)

    return target &&
      target.flags & SymbolFlags.TypeAlias &&
      this.getSymbolSourceKind(target) === 'project'
      ? target
      : undefined
  }

  private createDef(type: Type, preferredName: string): Def {
    let name = preferredName
    for (let i = 2; this.defsByName.has(name); i++) {
      name = `${preferredName}${i}`
    }

    const def: Def = { name, typeId: type.id }
    this.defs.set(type.id, def)
    this.defsByName.set(name, def)
    this.createdDefs.push(def)
    return def
  }

  private removeDef(def: Def): void {
    this.defs.delete(def.typeId)
    this.defsByName.delete(def.name)
  }

  private discardCreatedDefs(): void {
    for (const def of this.createdDefs) {
      this.removeDef(def)
    }
    for (const id of this.createdInlined) {
      this.inlined.delete(id)
    }
    this.createdDefs = []
    this.createdInlined = []
  }

  private getDefDeps(def: Def): Set<string> {
    def.deps ??= collectDefRefs(def.schema!)
    return def.deps
  }

  /**
   * The defs reachable from the given ones, including them.
   */
  private collectDeps(names: Iterable<string>): Set<string> {
    const collected = new Set<string>()
    const queue = [...names]

    while (queue.length) {
      const name = queue.pop()!
      const def = this.defsByName.get(name)

      if (collected.has(name) || !def) {
        continue
      }

      collected.add(name)
      queue.push(...this.getDefDeps(def))
    }

    return collected
  }

  private getSymbolSourceKind(symbol: TSSymbol): SourceKind {
    const path = symbol.declarations[0]?.path
    return path === undefined ? 'project' : this.getSourceKind(path)
  }

  /**
   * Declared by the runtime: the default library, or typings of runtime modules like `node:stream`.
   * For `Error` subclasses, everything declared outside the project.
   */
  private isBuiltinMember(symbol: TSSymbol, isError: boolean): boolean {
    return (
      symbol.declarations.length > 0 &&
      symbol.declarations.every((declaration) => {
        const kind = this.getSourceKind(declaration.path)
        return (
          kind === 'default' ||
          (kind === 'external' && (isError || RUNTIME_TYPINGS.test(declaration.path)))
        )
      })
    )
  }

  /**
   * Whether JSON serialization drops a property of this type: `undefined`, functions,
   * and symbols, optionally mixed with `undefined` (`cb?: () => void`).
   */
  private isDropped(type: Type): boolean {
    const members = type.isUnionType() ? this.getMembers(type) : [type]
    return members.every((m) => m.flags & UNDEFINED_FLAGS || this.isNonSerializable(m))
  }

  private isNonSerializable(type: Type): boolean {
    if (type.flags & TypeFlags.ESSymbolLike) {
      return true
    }

    if (
      !(type.flags & TypeFlags.Object) ||
      // object literals have no signatures
      this.isObjectLiteral(type) ||
      this.getReferenceKind(type) !== undefined
    ) {
      return false
    }

    // functions, also with properties (`{ (): void; displayName: string }`) or as constructors
    const symbol = type.getSymbol()
    if (symbol?.name === 'Function' && this.getSymbolSourceKind(symbol) === 'default') {
      return true
    }

    return (
      this.checker.getSignaturesOfType(type, SignatureKind.Call).length > 0 ||
      this.checker.getSignaturesOfType(type, SignatureKind.Construct).length > 0
    )
  }

  /**
   * A type of an object literal expression (`{ a: 1 }`), whose values are plain objects.
   */
  private isObjectLiteral(type: Type): boolean {
    return Boolean((type.getSymbol()?.flags ?? 0) & SymbolFlags.ObjectLiteral)
  }

  private hasMember(type: Type, flags: number): boolean {
    return type.isUnionType() && this.getMembers(type).some((m) => m.flags & flags)
  }

  private getMembers(type: Type): readonly Type[] {
    let members = this.membersCache.get(type.id)

    if (members === undefined) {
      members = (type as any).getTypes() ?? []
      this.membersCache.set(type.id, members!)
    }

    return members!
  }

  private getProperties(type: Type): readonly TSSymbol[] {
    let properties = this.propertiesCache.get(type.id)

    if (properties === undefined) {
      properties = this.checker.getPropertiesOfType(type)
      this.propertiesCache.set(type.id, properties)
    }

    return properties
  }

  /**
   * The type arguments it was written with: of the alias (`Page<User>`), else of the reference.
   */
  private getTypeArguments(type: Type): readonly Type[] {
    return type.getAliasSymbol() ? type.getAliasTypeArguments() : this.getReferenceArguments(type)
  }

  /**
   * The type arguments of a reference, like the `string` of `string[]`, even when it is aliased.
   */
  private getReferenceArguments(type: Type): readonly Type[] {
    let args = this.typeArgumentsCache.get(type.id)

    if (args === undefined) {
      args = isTypeReference(type) ? this.checker.getTypeArguments(type as TypeReference) : []
      this.typeArgumentsCache.set(type.id, args)
    }

    return args
  }

  private getReferenceKind(type: Type): 'array' | 'tuple' | undefined {
    if (!isTypeReference(type)) {
      return undefined
    }

    return this.checker.isArrayType(type)
      ? 'array'
      : this.checker.isTupleType(type)
        ? 'tuple'
        : undefined
  }
}
