import type { JsonSchema } from '@orpc/json-schema'
import { getJsonSchemaKeywordKind } from '@orpc/json-schema'
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

const MAPPED_METHOD_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.MethodDeclaration,
  SyntaxKind.MethodSignature,
])

const MAPPED_ACCESSOR_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.GetAccessor,
  SyntaxKind.SetAccessor,
])

const SERIALIZER_ONLY_NATIVE_TYPES = new Set(['set', 'map', 'bigint'])

/**
 * Whether a schema (without following refs) reaches a value the serializer handles
 * but `JSON.stringify` does not: a `Set`, `Map`, `bigint`, or binary value.
 */
function reachesSerializerOnlyValue(schema: JsonSchema, schemaLevel = true): boolean {
  if (typeof schema !== 'object' || schema === null) {
    return false
  }

  if (Array.isArray(schema)) {
    return schema.some((item) => reachesSerializerOnlyValue(item, schemaLevel))
  }

  if (
    schemaLevel &&
    (SERIALIZER_ONLY_NATIVE_TYPES.has((schema as any)['x-native-type']) ||
      typeof schema.contentMediaType === 'string')
  ) {
    return true
  }

  return Object.entries(schema).some(([key, value]) => {
    const kind = getJsonSchemaKeywordKind(key, value, schemaLevel)
    return (
      (kind === 'schema' && reachesSerializerOnlyValue(value as JsonSchema, true)) ||
      (kind === 'schema-record' && reachesSerializerOnlyValue(value as JsonSchema, false))
    )
  })
}

/** Members that identify a built-in through a mapped type over it, most specific first */
const MAPPED_BUILTIN_FINGERPRINTS: readonly (readonly [string, readonly string[]])[] = [
  ['Date', ['getTime', 'toISOString', 'getTimezoneOffset']],
  ['URL', ['href', 'origin', 'searchParams']],
  ['File', ['name', 'lastModified', 'arrayBuffer', 'slice']],
  ['Blob', ['size', 'arrayBuffer', 'slice', 'stream']],
  ['Map', ['get', 'set', 'has', 'delete', 'size']],
  ['Set', ['add', 'has', 'delete', 'size']],
  ['ReadonlyMap', ['get', 'has', 'size', 'forEach']],
  ['ReadonlySet', ['has', 'size', 'forEach']],
]

/** Typings of runtime built-in modules, whose classes are not data holders */
const RUNTIME_TYPINGS = /\/node_modules\/(?:@types\/(?:node|bun|deno)|bun-types)\//u

/** Nested instantiations of one declaration, like `Maybe<A>` inside `Maybe<B>` */
const MAX_NESTING = 16
/** Distinct instantiations nested in one outermost instantiation, once nested this deep */
const MAX_INSTANTIATIONS = 256
const MIN_BUDGET_NESTING = 4
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
  private readonly visitingStack: { type: Type; key: number }[] = []
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
  private truncations = 0
  /** Finished conversions of anonymous types, shared between their uses */
  private readonly anonymous = new Map<number, JsonSchema>()
  private createdAnonymous: number[] = []

  /**
   * Inside class instances, which the OpenAPI JSON serializer leaves to `JSON.stringify`:
   * `Set`, `Map`, and `Blob` become `{}`, and `bigint` can not be serialized.
   */
  private stringify = false

  private readonly membersCache = new Map<number, readonly Type[]>()
  private readonly propertiesCache = new Map<number, readonly TSSymbol[]>()
  private readonly typeArgumentsCache = new Map<number, readonly Type[]>()
  private readonly jsdocCache = new Map<number, JSDoc | undefined>()
  private readonly singleMemberEnumCache = new Map<number, TSSymbol | undefined>()
  private readonly annotationCache = new Map<number, { alias: TSSymbol; type: Type } | undefined>()
  private readonly globalTypes = new Map<string, Type | undefined>()

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
    type = this.getAwaitedType(type)
    const optional = this.isOptional(type)

    this.createdDefs = []
    this.createdInlined = []
    this.createdAnonymous = []
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
    this.createdAnonymous = []

    if (!Object.keys($defs).length) {
      return [schema, optional]
    }

    return [{ ...(typeof schema === 'object' ? schema : { not: {} }), $defs }, optional]
  }

  /**
   * The value of a `Promise`, like a handler's result.
   */
  private getAwaitedType(type: Type): Type {
    const symbol = type.flags & TypeFlags.Object ? type.getSymbol() : undefined

    if (
      symbol &&
      (symbol.name === 'Promise' || symbol.name === 'PromiseLike') &&
      this.getSymbolSourceKind(symbol) === 'default'
    ) {
      const [value] = this.getReferenceArguments(type)
      return value ? this.getAwaitedType(value) : type
    }

    return type
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
    const inlined = this.inlined.get(this.key(type))

    if (inlined !== undefined) {
      return structuredClone(inlined)
    }

    const existing = this.defs.get(this.key(type))

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
      this.truncations++
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

    if (
      stack.length >= MAX_NESTING ||
      // wide but shallow (`DeepPartial` over a model with many relations) is fine
      (stack.length >= MIN_BUDGET_NESTING && seen.size > MAX_INSTANTIATIONS)
    ) {
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
        this.inlined.set(this.key(type), schema)
        this.createdInlined.push(this.key(type))
        return structuredClone(schema)
      }

      def.schema = schema
      return { $ref: toRef(def.name) }
    }

    const memoized = this.anonymous.get(this.key(type))

    if (memoized !== undefined) {
      return memoized
    }

    const enteredAt = this.visiting.get(this.key(type))

    // the same anonymous type again, without a named def in between to stop at: a cycle.
    // Through a named def (`Tree[]` in `Tree`), converting it again ends at that def.
    if (enteredAt === this.namedDepth) {
      const closer = this.getCycleCloser(type)

      if (closer === undefined) {
        return { $ref: toRef(this.createDef(type, this.getFallbackDefName(type)).name) }
      }

      // convert this wrapper (`TreeNode[]`) once more, so the cycle closes at `TreeNode` instead
      this.cycleClosers.add(closer.key)
    }

    this.visiting.set(this.key(type), this.namedDepth)
    this.visitingStack.push({ type, key: this.key(type) })
    const truncations = this.truncations

    let schema: JsonSchema
    try {
      schema = this.convertType(type)
    } finally {
      this.visitingStack.pop()
      if (enteredAt === undefined) {
        this.visiting.delete(this.key(type))
      } else {
        this.visiting.set(this.key(type), enteredAt)
      }
    }

    if (projectSymbol) {
      schema = this.annotate(schema, projectSymbol)
    }

    // a self reference was found while converting, so the type became a def
    const def = this.defs.get(this.key(type))

    if (def) {
      def.schema ??= schema
      return { $ref: toRef(def.name) }
    }

    // reuse it for siblings, `{ a: C<N>; b: C<N> }` would otherwise grow exponentially in time
    if (enteredAt === undefined && truncations === this.truncations) {
      this.anonymous.set(this.key(type), schema)
      this.createdAnonymous.push(this.key(type))
    }

    return schema
  }

  /**
   * When a cycle comes back to a type without a good name, like `TreeNode[]` or
   * `Record<string, Dict>`, returns the named type in the cycle (`TreeNode`) to make the def for.
   */
  private getCycleCloser(type: Type): { type: Type; key: number } | undefined {
    const key = this.key(type)

    if (this.cycleClosers.has(key) || this.hasCycleName(type)) {
      return undefined
    }

    const start = this.visitingStack.findIndex((entry) => entry.key === key)

    // converted once more already, the closer did not come back
    if (this.visitingStack.filter((entry) => entry.key === key).length > 1) {
      return undefined
    }

    return this.visitingStack.slice(start + 1).find((entry) => this.hasCycleName(entry.type))
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

    if (flags & TypeFlags.BigIntLike) {
      if (this.stringify) {
        // `JSON.stringify` throws on a bigint
        return { not: {} }
      }

      return flags & TypeFlags.BigIntLiteral
        ? { ...bigintSchema(), const: String((type as any).value) }
        : bigintSchema()
    }

    if (flags & TypeFlags.String) {
      return { type: 'string' }
    }

    // includes computed enum members, e.g. `enum E { A = key.length }`
    if (flags & (TypeFlags.NumberLike | TypeFlags.Enum)) {
      return { type: 'number' }
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
        // only while that union is being converted, an unrelated `boolean | null` is not `Flag`
        const named = this.nullableCores.get(core.id)
        if (named && named.id !== type.id && hasNull && this.isConverting(named)) {
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

  private convertObject(type: Type, ignoreToJSON = false): JsonSchema {
    const referenceKind = this.getReferenceKind(type)

    if (referenceKind === 'array') {
      return { type: 'array', items: this.visitElement(this.getReferenceArguments(type)[0]) }
    }

    if (referenceKind === 'tuple') {
      return this.convertTuple(type as TypeReference)
    }

    const builtin = this.convertBuiltinObject(type) ?? this.convertMappedBuiltin(type)
    if (builtin !== undefined) {
      return builtin
    }

    // the class behind `Readonly<C>`, `Pick<C, K>`, or `C & { extra }` (`Object.freeze`, `Object.assign`)
    const classType = this.getClassType(type)

    if (classType && classType.id !== type.id) {
      const subclass = this.convertBuiltinObject(classType)
      if (subclass !== undefined) {
        return subclass
      }
    }

    const properties = this.getProperties(type)

    // the serializer walks plain objects key by key, only other objects go through `toJSON`
    const toJSON =
      ignoreToJSON || (this.isObjectLiteral(type) && !this.stringify)
        ? undefined
        : properties.find((p) => p.name === 'toJSON')
    if (toJSON) {
      const returnType = getCallReturnType(this.checker, this.checker.getTypeOfSymbol(toJSON))
      if (returnType) {
        return this.withStringify(() => this.convertToJSONResult(returnType))
      }
    }

    const isClassInstance = classType !== undefined
    // members of `Error` subclasses from packages are not data either (`ZodError#issues` is a getter)
    const isError = isClassInstance && this.getBuiltinBaseName(classType) === 'Error'

    const dataProperties = properties.filter(
      (p) =>
        !(p.flags & (SymbolFlags.Method | SymbolFlags.Prototype)) &&
        // symbol keys (`__@iterator@12`) and #private fields (`__#12@#secret`);
        // quoted keys starting with `__` are escaped with another `_`
        !p.escapedName.startsWith('__@') &&
        !p.escapedName.startsWith('__#') &&
        !isClassAccessor(p) &&
        // mapped types keep methods (`DeepPartial<Account>`) and class accessors (`Readonly<C>`)
        // as properties, still functions or on the prototype
        !(
          p.flags & SymbolFlags.Transient &&
          p.declarations.length > 0 &&
          p.declarations.every(
            (d) =>
              MAPPED_METHOD_KINDS.has(d.kind) ||
              (isClassInstance && MAPPED_ACCESSOR_KINDS.has(d.kind)),
          )
        ) &&
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

      const valueType = this.getNullableAliasType(property, propertyType) ?? propertyType
      let propertySchema = isClassInstance
        ? this.visitInClassInstance(valueType)
        : this.visit(valueType)

      // an alias of a primitive or literal (`type Count = number`) leaves no trace in the type,
      // so its JSDoc is read through the property's type annotation
      if (isTrivialSchema(propertySchema) || isLiteralSchema(propertySchema)) {
        propertySchema = this.annotate(
          propertySchema,
          this.getAnnotationAlias(property, propertyType),
        )
      }

      schema.properties[property.name] = this.annotate(propertySchema, property)

      if (!(property.flags & SymbolFlags.Optional) && !this.isOptional(propertyType)) {
        required.push(property.name)
      }
    }

    if (required.length) {
      schema.required = required
    }

    const indexInfos = this.checker.getIndexInfosOfType(type)
    // a string (or number) index covers every key, narrower template literal keys add nothing
    const anyKey =
      indexInfos.find((info) => info.keyType.flags & TypeFlags.String) ??
      indexInfos.find((info) => info.keyType.flags & TypeFlags.Number)
    const patternKeys = indexInfos.filter(
      (info) => info.keyType.flags & (TypeFlags.TemplateLiteral | TypeFlags.StringMapping),
    )

    if (anyKey) {
      schema.additionalProperties = this.visit(anyKey.valueType)
    } else if (patternKeys.length === 1 && !Object.keys(schema.properties).length) {
      // like zod records with template literal keys, which keeps the value type in OpenAPI 3.0
      schema.propertyNames = {
        type: 'string',
        pattern: `^${this.toPattern(patternKeys[0]!.keyType)}$`,
      }
      schema.additionalProperties = this.visit(patternKeys[0]!.valueType)
    } else {
      for (const info of patternKeys) {
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
      // `Blob`, `File`, and `URL` without the DOM library come from the runtime's typings
      const runtimeGlobal =
        symbol.declarations.length > 0 &&
        symbol.declarations.every((d) => RUNTIME_TYPINGS.test(d.path))
          ? this.getLeafBuiltinSchema(symbol.name)
          : undefined

      return (
        runtimeGlobal ??
        (symbol.flags & SymbolFlags.Class ? this.convertBuiltinSubclass(type) : undefined)
      )
    }

    const leaf = this.getLeafBuiltinSchema(symbol.name)
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
        return this.toSetSchema(() => this.visitElement(first))
      case 'Map':
      case 'ReadonlyMap':
        return this.toMapSchema(() => ({
          type: 'array',
          prefixItems: [this.visitElement(first), this.visitElement(second)],
          maxItems: 2,
          minItems: 2,
        }))
      case 'Promise':
      case 'PromiseLike':
        // only the converted value itself is awaited, a nested promise is serialized as `{}`
        return { type: 'object' }
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
   * `DeepReadonly<Date>` or `DeepPartial<Set<string>>` maps over the built-in's methods,
   * but the value is still the built-in and serialized like it.
   */
  private convertMappedBuiltin(type: Type): JsonSchema | undefined {
    if (!((type as any).objectFlags & ObjectFlags.Mapped)) {
      return undefined
    }

    const properties = this.getProperties(type)

    if (!properties.length || !properties.every((p) => this.isBuiltinMember(p, false))) {
      return undefined
    }

    // mapped members keep the declarations of the built-in they come from (`Date#getTime`),
    // which tells `Map` apart from look-alikes such as `URLSearchParams`
    const byName = new Map(properties.map((p) => [p.name, p]))
    const builtin = MAPPED_BUILTIN_FINGERPRINTS.find(([name, members]) => {
      const global = this.getGlobalType(name)

      return (
        global !== undefined &&
        members.every((member) => {
          const own = this.checker.getPropertyOfType(global, member)?.declarations[0]
          const mapped = byName.get(member)?.declarations[0]
          return own && mapped && own.path === mapped.path && own.index === mapped.index
        })
      )
    })?.[0]

    if (builtin === undefined) {
      return undefined
    }

    // `DeepReadonly<Set<string>>` still knows its item type
    const [source] = this.getTypeArguments(type)
    if (source && source.flags & TypeFlags.Object && source.getSymbol()?.name === builtin) {
      const precise = this.convertBuiltinObject(source)
      if (precise !== undefined) {
        return precise
      }
    }

    if (builtin === 'Set' || builtin === 'ReadonlySet') {
      return this.toSetSchema(() => ({}))
    }

    if (builtin === 'Map' || builtin === 'ReadonlyMap') {
      return this.toMapSchema(() => ({}))
    }

    return this.getLeafBuiltinSchema(builtin)
  }

  private getGlobalType(name: string): Type | undefined {
    if (!this.globalTypes.has(name)) {
      const symbol = this.checker.resolveName(name, SymbolFlags.Type)
      this.globalTypes.set(name, symbol && this.checker.getDeclaredTypeOfSymbol(symbol))
    }

    return this.globalTypes.get(name)
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
        ? this.toSetSchema(() => this.visitElement(item))
        : this.toMapSchema(() => (item ? this.visit(item) : {}))
    }

    return this.getLeafBuiltinSchema(base)
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
    const symbolName = this.getSymbolName(symbol)
    // internal names like `__class` (class expressions) are not used
    const internal = symbolName.startsWith('__')

    if (!internal && (symbol.flags & SymbolFlags.Enum || !this.getTypeArguments(type).length)) {
      return symbolName
    }

    return (
      toDefName(this.checker.typeToString(type)) ??
      (internal ? this.getFallbackDefName(type) : symbolName)
    )
  }

  /**
   * The declared name of a symbol, also for default exports (`export default class Account`).
   */
  private getSymbolName(symbol: TSSymbol): string {
    if (symbol.name !== 'default') {
      return symbol.name
    }

    const node = symbol.declarations[0]?.resolve() as any
    return typeof node?.name?.text === 'string' ? node.name.text : symbol.name
  }

  private getFallbackDefName(type: Type): string {
    const symbol = type.getAliasSymbol() ?? type.getSymbol()
    const name = symbol && this.getSymbolName(symbol)

    if (name && /^[\w$]+$/u.test(name) && !name.startsWith('__')) {
      return name
    }

    return toDefName(this.checker.typeToString(type)) ?? 'Recursive'
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
   * `status?: Status` with `type Status = 'open' | null` has the type `'open' | null | undefined`,
   * which no longer carries the alias, and stripping `undefined` through the checker also strips
   * `null`. The alias type of the annotation keeps the def and its JSDoc, when it is the same type.
   */
  private getNullableAliasType(property: TSSymbol, type: Type): Type | undefined {
    if (!this.hasMember(type, UNDEFINED_FLAGS) || !this.hasMember(type, TypeFlags.Null)) {
      return undefined
    }

    const annotated = this.getAnnotation(property)?.type

    if (
      !annotated?.isUnionType() ||
      !this.hasMember(annotated, TypeFlags.Null) ||
      this.hasMember(annotated, UNDEFINED_FLAGS)
    ) {
      return undefined
    }

    const ids = (t: Type) =>
      new Set(
        this.getMembers(t)
          .filter((m) => !(m.flags & UNDEFINED_FLAGS))
          .map((m) => m.id),
      )
    const annotatedIds = ids(annotated)
    const typeIds = ids(type)

    // `status?: Status | 'archived'`, or a mapped type changing the value, is another type
    return annotatedIds.size === typeIds.size && [...typeIds].every((id) => annotatedIds.has(id))
      ? annotated
      : undefined
  }

  /**
   * The project type alias a property's type annotation names (`count?: Count | null`),
   * when the property still has that type: a mapped type like `{ [K in keyof T]: boolean }`
   * keeps the source declaration but not its type.
   */
  private getAnnotationAlias(property: TSSymbol, type: Type): TSSymbol | undefined {
    const annotation = this.getAnnotation(property)

    if (!annotation) {
      return undefined
    }

    const members = type.isUnionType() ? this.getMembers(type) : [type]

    return annotation.type.id === type.id || members.some((m) => m.id === annotation.type.id)
      ? annotation.alias
      : undefined
  }

  private getAnnotation(property: TSSymbol): { alias: TSSymbol; type: Type } | undefined {
    if (this.annotationCache.has(property.id)) {
      return this.annotationCache.get(property.id)
    }

    let annotation: { alias: TSSymbol; type: Type } | undefined
    const declaration = property.declarations[0]

    if (declaration && this.getSourceKind(declaration.path) === 'project') {
      let typeNode = (declaration.resolve() as any)?.type

      // `count?: Count | null`
      if (typeNode?.kind === SyntaxKind.UnionType) {
        const references = typeNode.types.filter((t: any) => t.kind === SyntaxKind.TypeReference)
        typeNode = references.length === 1 ? references[0] : undefined
      }

      if (typeNode?.kind === SyntaxKind.TypeReference) {
        const symbol = this.checker.getSymbolAtLocation(typeNode.typeName)
        const alias = symbol && resolveAlias(this.checker, symbol)

        if (
          alias &&
          alias.flags & SymbolFlags.TypeAlias &&
          this.getSymbolSourceKind(alias) === 'project'
        ) {
          // the instantiated alias type, `Maybe<string>` rather than `T | null`
          const type = this.checker.getTypeAtLocation(typeNode)
          annotation = type ? { alias, type } : undefined
        }
      }
    }

    this.annotationCache.set(property.id, annotation)
    return annotation
  }

  private createDef(type: Type, preferredName: string): Def {
    // `Page_1` and `Page_12` must not collide as `Page_12`
    const separator = /\d$/u.test(preferredName) ? '_' : ''
    let name = preferredName
    for (let i = 2; this.defsByName.has(name); i++) {
      name = `${preferredName}${separator}${i}`
    }

    const def: Def = { name, typeId: this.key(type) }
    this.defs.set(def.typeId, def)
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
    for (const id of this.createdAnonymous) {
      this.anonymous.delete(id)
    }
    this.createdDefs = []
    this.createdInlined = []
    this.createdAnonymous = []
  }

  private getDefDeps(def: Def): Set<string> {
    // an unfinished def has no deps yet, and must not cache that
    if (def.schema === undefined) {
      return new Set()
    }

    def.deps ??= collectDefRefs(def.schema)
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

  private isConverting(type: Type): boolean {
    const def = this.defs.get(this.key(type))
    return def !== undefined && def.schema === undefined
  }

  /**
   * A type of an object literal expression (`{ a: 1 }`), whose values are plain objects.
   */
  private isObjectLiteral(type: Type): boolean {
    return Boolean((type.getSymbol()?.flags ?? 0) & SymbolFlags.ObjectLiteral)
  }

  private getLeafBuiltinSchema(name: string): JsonSchema | undefined {
    // `JSON.stringify` has no handling for binary values, they become `{}`
    return this.stringify && (name === 'Blob' || name === 'File')
      ? { type: 'object' }
      : getLeafBuiltinSchema(name)
  }

  private toSetSchema(items: () => JsonSchema): JsonSchema {
    return this.stringify ? { type: 'object' } : setSchema(items())
  }

  private toMapSchema(entries: () => JsonSchema): JsonSchema {
    return this.stringify ? { type: 'object' } : mapSchema(entries())
  }

  /**
   * `JSON.stringify` calls `toJSON` once: the returned value is serialized by its own fields,
   * so a returned `Date` is `{}`, and `this` (or `{ ...this }`) are the instance's fields.
   * Its properties and items go through `toJSON` again, so they are converted as usual.
   */
  private convertToJSONResult(type: Type): JsonSchema {
    const resolved =
      type.flags & TypeFlags.TypeParameter
        ? (this.checker.getBaseConstraintOfType(type) ?? type)
        : type

    if (
      !(resolved.flags & (TypeFlags.Object | TypeFlags.Intersection)) ||
      this.getReferenceKind(resolved) !== undefined
    ) {
      return this.visit(resolved)
    }

    const symbol = resolved.getSymbol()

    // built-ins have no own enumerable data, except typed arrays
    if (symbol && !TYPED_ARRAYS.has(symbol.name) && this.isBuiltinSymbol(symbol)) {
      return { type: 'object' }
    }

    return this.convertObject(resolved, true)
  }

  /**
   * The class instance type of a type, also through `Readonly<C>`, `Pick<C, K>`, `C & { ... }`,
   * and `this`.
   */
  private getClassType(type: Type): Type | undefined {
    if ((type.getSymbol()?.flags ?? 0) & SymbolFlags.Class) {
      return type
    }

    if (type.flags & TypeFlags.TypeParameter) {
      const constraint = this.checker.getBaseConstraintOfType(type)
      return constraint && constraint.id !== type.id ? this.getClassType(constraint) : undefined
    }

    if (type.isIntersectionType()) {
      for (const member of this.getMembers(type)) {
        const classType = this.getClassType(member)
        if (classType) {
          return classType
        }
      }
      return undefined
    }

    if ((type as any).objectFlags & ObjectFlags.Mapped) {
      const [source] = this.getTypeArguments(type)
      return source && source.flags & TypeFlags.Object ? this.getClassType(source) : undefined
    }

    return undefined
  }

  /**
   * Declared by the default library or the runtime's typings.
   */
  private isBuiltinSymbol(symbol: TSSymbol): boolean {
    return (
      symbol.declarations.length > 0 &&
      symbol.declarations.every(
        (d) => this.getSourceKind(d.path) === 'default' || RUNTIME_TYPINGS.test(d.path),
      )
    )
  }

  /**
   * Converts a value of a class instance, which `JSON.stringify` serializes. Converted again
   * under its rules only when they make a difference, so shared models keep one def.
   */
  private visitInClassInstance(type: Type): JsonSchema {
    const schema = this.visit(type)

    return !this.stringify && this.dependsOnSerializer(schema)
      ? this.withStringify(() => this.visit(type))
      : schema
  }

  /**
   * Keys of conversion results, which differ between the serializer and `JSON.stringify`.
   */
  private key(type: Type): number {
    return this.stringify ? -type.id : type.id
  }

  private withStringify<T>(fn: () => T): T {
    const previous = this.stringify
    this.stringify = true
    try {
      return fn()
    } finally {
      this.stringify = previous
    }
  }

  /**
   * Whether `JSON.stringify` serializes values of a schema differently than the serializer:
   * when it reaches a `Set`, `Map`, `bigint`, or binary value.
   */
  private dependsOnSerializer(schema: JsonSchema): boolean {
    if (reachesSerializerOnlyValue(schema)) {
      return true
    }

    for (const name of this.collectDeps(collectDefRefs(schema))) {
      const def = this.defsByName.get(name)!.schema

      // still being converted, so undecided: convert under `JSON.stringify` rules to be safe
      if (def === undefined || reachesSerializerOnlyValue(def)) {
        return true
      }
    }

    return false
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

/**
 * A def name from a printed type: `Page<User>` -> `Page_User`, `Page<User[]>` -> `Page_UserArray`,
 * `Event<"message", Message>` -> `Event_message_Message`, `Pair<[A, B]>` -> `Pair_A_B`.
 * Types with object literals, functions, unions, or intersections in their arguments are not named this way.
 */
function toDefName(text: string): string | undefined {
  if (text.length > 80 || /[{}()|&]|=>|\.\.\./u.test(text) || !/^[\w$.]+(?:<.*>)?$/u.test(text)) {
    return undefined
  }

  return (
    text
      .replace(/\[\]/gu, 'Array')
      .replace(/-(?=\d)/gu, 'neg')
      .replace(/[^\w$.]+/gu, '_')
      .replace(/^_+|_+$/gu, '') || undefined
  )
}
