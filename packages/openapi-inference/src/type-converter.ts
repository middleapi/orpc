import type { JsonSchema } from '@orpc/json-schema'
import { setOwn } from '@orpc/shared'
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

import {
  extendsBuiltinClass,
  getBuiltin,
  getBoxedPrimitiveSchema,
  getBuiltinBaseName,
  getBuiltinFields,
  getNumberIndexType,
  getTypedArrayViewBases,
  getViewBases,
  hasBuiltinForm,
  isBoxedBigInt,
  isTypedArray,
} from './builtins'
import type { DefNameRecord } from './components'
import { getDefName, getFallbackDefName, getViewDefName } from './def-names'
import type { ConversionMode, Def } from './defs'
import { DefNames, DefRegistry, toModeKey } from './defs'
import { ExpansionGuard } from './expansion'
import {
  getClassType,
  isBuiltinMember,
  getClassTypes,
  getDataProperties,
  getToJSONResultTypes,
  getViewedFunction,
  hasOptionalToJSON,
  isClassView,
  isDropped,
  isFunction,
  isNonSerializable,
  mayBeNonSerializable,
  ModeSensitivity,
} from './json-rules'
import type { ObjectJsonSchema } from './schema-utils'
import {
  applyJSDoc,
  bigintSchema,
  collectDefRefs,
  dedupe,
  escapeRegExp,
  isLiteralSchema,
  isPlain,
  isTrivialSchema,
  mapSchema,
  setSchema,
  toRef,
  withNull,
} from './schema-utils'
import {
  getNamedSymbol,
  INSTANTIABLE_FLAGS,
  isObjectLiteral,
  NULLISH_FLAGS,
  PRIMITIVE_FLAGS,
  TypeQueries,
  UNDEFINED_FLAGS,
} from './type-queries'
import { getIteratorTypes } from './utils'

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

  /**
   * Which values the schemas describe:
   *
   * - `output`: values the server sends, serialized by oRPC's OpenAPI JSON serializer, which
   *   leaves class instances to `JSON.stringify`.
   * - `input`: values a client sends, decoded from JSON, so class types are plain objects.
   *
   * @default 'output'
   */
  direction?: 'input' | 'output' | undefined
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
  /** The yielded values, a union of these types */
  yieldTypes: readonly Type[]
  /** The returned values, a union of these types, empty when it returns nothing */
  returnTypes: readonly Type[]
}

const SHARED = new WeakMap<Checker, { types: TypeQueries; names: DefNames }>()

const LITERAL_FLAGS = TypeFlags.StringLiteral | TypeFlags.NumberLiteral | TypeFlags.BooleanLiteral

/**
 * Converts TypeScript types into JSON Schemas (draft 2020-12), describing values
 * as they look after oRPC's OpenAPI JSON serialization, e.g. `Date` as a `date-time` string.
 *
 * Named types are emitted as `$defs`. Conversions share a cache, so reuse one converter per program.
 *
 * @see {@link https://orpc.dev/docs/openapi/specification#converting-types-directly | OpenAPI Specification - Converting Types Directly}
 */
export class TypeToJsonSchemaConverter {
  private readonly defsMode: 'named' | 'recursive'
  /** Values a client sends, decoded from JSON: classes are plain objects, `toJSON` is not called */
  private readonly input: boolean
  private readonly types: TypeQueries
  private readonly names: DefNames
  private readonly defs: DefRegistry
  private readonly expansion: ExpansionGuard
  /** Types whose `JSON.stringify` form differs from their serializer form */
  private readonly stringifySensitivity: ModeSensitivity
  /** Types whose `either` form differs from their serializer form */
  private readonly eitherSensitivity: ModeSensitivity

  /** Anonymous types being converted, with the named depth they were entered at */
  private readonly visiting = new Map<number, number>()
  private readonly visitingStack: { type: Type; key: number }[] = []
  /** Types that close a cycle, preferred over wrappers around them for the def */
  private readonly cycleClosers = new Set<number>()
  /** Non-null cores of named nullable unions, back to the union (`Json` without `null` -> `Json`) */
  private readonly nullableCores = new Map<number, Type>()
  private namedDepth = 0
  /** Defs by their class (of a view) or name and their schema, shared by the same schema */
  private readonly sharedDefs = new Map<string, Def>()
  private voidType: Type | undefined
  /** Interfaces over views of typed arrays being converted as one of the values they may hold */
  private readonly typedArrayForms = new Map<number, 'typed' | 'plain'>()

  /**
   * Who writes the value being converted:
   *
   * - `serializer`: the OpenAPI JSON serializer, which walks plain objects and arrays, and leaves
   *   class instances to `JSON.stringify`.
   * - `stringify`: `JSON.stringify`, inside class instances: `Set`, `Map`, and `Blob` become `{}`,
   *   `bigint` can not be serialized, and `toJSON` of plain objects is called.
   * - `either`: one of them, inside a view of a class (`Readonly<C>`), which holds an instance
   *   (written by `JSON.stringify`) or a plain object (walked by the serializer). Each value is
   *   either form, field by field, so views along a chain of views are written once each.
   */
  private mode: ConversionMode = 'serializer'

  constructor(
    private readonly checker: Checker,
    program: Program,
    options: TypeToJsonSchemaConverterOptions = {},
  ) {
    this.defsMode = options.defs ?? 'named'
    this.input = options.direction === 'input'
    // converters of one program (for inputs and outputs) share the compiler queries and def names
    let shared = SHARED.get(checker)
    if (!shared) {
      const types = new TypeQueries(checker, program)
      shared = {
        types,
        names: new DefNames(),
      }
      SHARED.set(checker, shared)
    }
    this.types = shared.types
    this.names = shared.names
    this.defs = new DefRegistry(shared.names)
    this.expansion = new ExpansionGuard(this.types)
    this.stringifySensitivity = new ModeSensitivity(this.types, 'stringify')
    this.eitherSensitivity = new ModeSensitivity(this.types, 'either')
  }

  /**
   * Converts a type, returning its schema, with the `$defs` it references, and whether it accepts `undefined`.
   */
  convert(
    type: Type | readonly Type[],
    options: TypeToJsonSchemaConvertOptions = {},
  ): [jsonSchema: JsonSchema, optional: boolean] {
    // a list of types is their union, like the yield types of a union of async iterators
    const members = (Array.isArray(type) ? type : [type]).flatMap((t) => this.getAwaitedTypes(t))

    // a function (also with properties, `(() => number) & { tag: string }`) is written as nothing,
    // like `undefined`, also as a member of a union
    const unions = members.flatMap((t) => (t.isUnionType() ? this.types.getMembers(t) : [t]))
    const serializable = unions.filter((t) => !isNonSerializable(this.types, t))
    const filtered = serializable.length < unions.length
    let optional = filtered || members.some((t) => this.isOptional(t))
    // a single value is visited whole, so a union keeps its def
    const values = filtered ? serializable : members

    // a function whose `toJSON` is optional may be written as nothing too
    if (unions.some((t) => mayBeNonSerializable(this.types, t))) {
      optional = true
    }

    const cuts = this.expansion.cuts
    this.expansion.reset()

    let schema: JsonSchema
    let $defs: Record<string, JsonSchema>

    try {
      schema = values.length === 1 ? this.visit(values[0]!) : this.convertMembers(serializable)

      if (options.inlineRoot) {
        schema = this.defs.inlineRoot(schema, options.inlineProperties ?? [])
      }

      $defs = this.defs.getReferencedDefs(schema)
    } catch (error) {
      // defs of a failed conversion may be unfinished or reference unfinished ones
      this.defs.discardCreated()
      throw error
    }

    // a cut expansion depends on where the conversion started, so it is not reused
    if (this.expansion.cuts !== cuts) {
      this.defs.discardCreated(true)
    } else {
      this.defs.keepCreated()
    }

    if (!Object.keys($defs).length) {
      return [schema, optional]
    }

    return [{ ...(typeof schema === 'object' ? schema : { not: {} }), $defs }, optional]
  }

  /**
   * The def names the conversions of this program gave (see `mergeEquivalentComponents`).
   */
  getDefNames(): DefNameRecord {
    return this.names
  }

  /**
   * Returns the yield and return types when the type is an async iterable, such as an `AsyncGenerator`,
   * also of a union of async iterables (`AsyncGenerator<A> | AsyncGenerator<B> | undefined`).
   */
  getAsyncIteratorTypes(type: Type): AsyncIteratorTypes | undefined {
    return this.types.memo('asyncIterator', type.id, () => this.computeAsyncIteratorTypes(type))
  }

  private computeAsyncIteratorTypes(type: Type): AsyncIteratorTypes | undefined {
    if (type.isUnionType()) {
      const members = this.types.getMembers(type).filter((m) => !(m.flags & NULLISH_FLAGS))
      const all = members.map((m) => this.getAsyncIteratorTypes(m))

      if (!all.length || !all.every((t) => t !== undefined)) {
        return undefined
      }

      const returnTypes = all.flatMap((t) => t!.returnTypes)

      return {
        yieldTypes: all.flatMap((t) => t!.yieldTypes),
        // members that return nothing make the returned value optional
        returnTypes:
          returnTypes.length && all.some((t) => !t!.returnTypes.length)
            ? [...returnTypes, (this.voidType ??= this.checker.getVoidType())]
            : returnTypes,
      }
    }

    if (!(type.flags & TypeFlags.Object)) {
      return undefined
    }

    const types = getIteratorTypes(this.checker, type, this.types.getProperties(type), true)

    return (
      types && {
        yieldTypes: types.yieldTypes,
        // `void` and `undefined` returns send no value
        returnTypes: types.returnTypes.filter((t) => !(t.flags & UNDEFINED_FLAGS)),
      }
    )
  }

  /**
   * Whether the value can be `undefined`, i.e. omitted.
   */
  isOptional(type: Type): boolean {
    return Boolean(
      type.flags & (UNDEFINED_FLAGS | TypeFlags.Any | TypeFlags.Unknown) ||
      this.types.hasMember(type, UNDEFINED_FLAGS),
    )
  }

  /**
   * The values of a handler's result: `Promise<A> | B` (returned by a handler without `async`)
   * is `A | B` once awaited.
   */
  private getAwaitedTypes(type: Type): Type[] {
    if (type.isUnionType()) {
      const members = this.types.getMembers(type)

      if (members.some((m) => this.getAwaitedType(m) !== m)) {
        return members.flatMap((m) => this.getAwaitedTypes(m))
      }
    }

    const awaited = this.getAwaitedType(type)
    return awaited === type ? [type] : this.getAwaitedTypes(awaited)
  }

  /**
   * The value of a `Promise`, like a handler's result.
   */
  private getAwaitedType(type: Type): Type {
    const symbol = type.flags & TypeFlags.Object ? type.getSymbol() : undefined

    if (
      symbol &&
      (symbol.name === 'Promise' || symbol.name === 'PromiseLike') &&
      this.types.getSymbolSourceKind(symbol) === 'default'
    ) {
      const [value] = this.types.getReferenceArguments(type)
      return value ? this.getAwaitedType(value) : type
    }

    return type
  }

  private visit(type: Type): JsonSchema {
    // `DeepReadonly<DeepReadonly<X>>` (a deep view of a class holding one) is `DeepReadonly<X>`,
    // which keeps a graph of deep views from nesting them without end
    const flattened = this.types.getFlattenedView(type)
    if (flattened.id !== type.id) {
      return this.visit(flattened)
    }

    const key = this.key(type)
    const existing = this.defs.get(key)

    if (existing) {
      return { $ref: toRef(existing.name) }
    }

    if (type.isErrorType()) {
      throw new TypeScriptTypeResolutionError(
        `Could not resolve the type "${this.checker.typeToString(type)}". Check its import, and the tsconfig "paths" for aliases like "@/".`,
      )
    }

    // `X | undefined` is `X`, the caller makes it optional, also when an alias distributes over
    // it (`DeepPartial<X | undefined>` is `DeepPartial<X> | undefined`), which keeps one def for `X`
    if (type.isUnionType()) {
      const defined = this.types.getMembers(type).filter((m) => !(m.flags & UNDEFINED_FLAGS))
      if (defined.length === 1) {
        return this.visit(defined[0]!)
      }
    }

    const singleMemberEnum = this.types.getSingleMemberEnum(type)

    if (!(type.flags & (TypeFlags.Object | TypeFlags.UnionOrIntersection)) && !singleMemberEnum) {
      return this.convertType(type)
    }

    return (
      this.expansion.expand(type, () => this.visitStructured(type, key, singleMemberEnum)) ?? {}
    )
  }

  private visitStructured(
    type: Type,
    key: number,
    singleMemberEnum: TSSymbol | undefined,
  ): JsonSchema {
    const memoized = this.defs.getAnonymous(key)

    if (memoized !== undefined) {
      return memoized
    }

    const namedSymbol = singleMemberEnum ?? getNamedSymbol(type)
    const projectSymbol =
      namedSymbol && this.types.getSymbolSourceKind(namedSymbol) === 'project'
        ? namedSymbol
        : undefined

    // a view of a project class (`Readonly<User>`) is shared by the models referring to it,
    // so it is written once, like the class
    const viewName =
      this.defsMode === 'named' && !projectSymbol ? this.getViewDefName(type) : undefined

    if (
      this.defsMode === 'named' &&
      (projectSymbol || viewName) &&
      !(type.flags & TypeFlags.Boolean)
    ) {
      // the name of a view yields to a declared type of that name, whichever comes first
      const preferredName = viewName ?? getDefName(this.types, type, projectSymbol!)
      const def = this.defs.create(key, preferredName)
      const cuts = this.expansion.cuts

      this.namedDepth++
      let schema: JsonSchema
      try {
        schema = this.annotate(this.convertType(type), projectSymbol)
      } finally {
        this.namedDepth--
      }

      def.stable = cuts === this.expansion.cuts

      // a named primitive, like `type UserId = string & { __brand: 'UserId' }`, is clearer inline.
      // It has no refs, so nothing references the def yet.
      if (isTrivialSchema(schema)) {
        this.defs.inline(def, schema)
        return schema
      }

      def.schema = schema
      this.defs.reclaimName(def, preferredName)

      // a view referring to no defs is written in place, like an anonymous type: only views
      // reaching other defs are shared, which keeps graphs of views linear. So is a view of
      // a function (`DeepReadonly<() => void>`).
      if (
        (viewName || getViewedFunction(this.types, type)) &&
        !collectDefRefs(schema).size &&
        this.defs.replaceIfUnreferenced(def, schema)
      ) {
        return schema
      }

      // views of one class with the same schema (`Readonly<C>`, `Pick<C, keyof C>`) share a def,
      // and so do types printed the same (`DeepPartial<Map<string, number>>`, instantiated
      // once for a union it distributes over and once more alone) with the same schema
      const signature = `${viewName ? getClassType(this.types, type)!.id : preferredName}:${this.defs.stringify(schema)}`
      const existing = this.sharedDefs.get(signature)
      const ref = existing && { $ref: toRef(existing.name) }

      if (
        existing &&
        existing.key !== key &&
        this.defs.get(existing.key)?.name === existing.name &&
        this.defs.replaceIfUnreferenced(def, ref!)
      ) {
        return ref!
      }

      this.sharedDefs.set(signature, def)

      return { $ref: toRef(def.name) }
    }

    const enteredAt = this.visiting.get(key)

    // the same anonymous type again, without a named def in between to stop at: a cycle.
    // Through a named def (`Tree[]` in `Tree`), converting it again ends at that def.
    if (enteredAt === this.namedDepth) {
      const closer = this.getCycleCloser(type, key)

      if (closer === undefined) {
        return { $ref: toRef(this.defs.create(key, getFallbackDefName(this.types, type)).name) }
      }

      // convert this wrapper (`TreeNode[]`) once more, so the cycle closes at `TreeNode` instead
      this.cycleClosers.add(closer.key)
    }

    this.visiting.set(key, this.namedDepth)
    this.visitingStack.push({ type, key })
    const cuts = this.expansion.cuts

    let schema: JsonSchema
    try {
      schema = this.convertType(type)
    } finally {
      this.visitingStack.pop()
      if (enteredAt === undefined) {
        this.visiting.delete(key)
      } else {
        this.visiting.set(key, enteredAt)
      }
    }

    schema = this.annotate(schema, projectSymbol)

    // a self reference was found while converting, so the type became a def
    const def = this.defs.get(key)

    if (def) {
      if (def.schema === undefined) {
        def.schema = schema
        def.stable = cuts === this.expansion.cuts
      }
      return { $ref: toRef(def.name) }
    }

    // reuse it for siblings, `{ a: C<N>; b: C<N> }` would otherwise grow exponentially in time
    if (enteredAt === undefined && cuts === this.expansion.cuts) {
      this.defs.setAnonymous(key, schema)
    }

    return schema
  }

  /**
   * When a cycle comes back to a type without a good name, like `TreeNode[]` or
   * `Record<string, Dict>`, returns the named type in the cycle (`TreeNode`) to make the def for.
   */
  private getCycleCloser(type: Type, key: number): { type: Type; key: number } | undefined {
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
    const symbol = getNamedSymbol(type)

    return Boolean(
      symbol &&
      !symbol.name.startsWith('__') &&
      this.types.getSymbolSourceKind(symbol) !== 'default',
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
      const serialized: JsonSchema =
        flags & TypeFlags.BigIntLiteral
          ? { ...bigintSchema(), const: String((type as any).value) }
          : bigintSchema()

      if (this.mode === 'serializer') {
        return serialized
      }

      // `JSON.stringify` throws on a bigint, unless `BigInt.prototype.toJSON` is polyfilled
      const toJSONResults = this.getBigIntToJSONResultTypes()
      const stringified = toJSONResults.length
        ? anyOfDeduped(this.convertToJSONResults(toJSONResults))
        : undefined

      if (this.mode === 'stringify') {
        return stringified || { not: {} }
      }

      return stringified ? anyOfDeduped([serialized, stringified]) : serialized
    }

    if (flags & TypeFlags.String) {
      return { type: 'string' }
    }

    // includes computed enum members, e.g. `enum E { A = key.length }`
    if (flags & (TypeFlags.NumberLike | TypeFlags.Enum)) {
      return { type: 'number' }
    }

    if (flags & TypeFlags.TemplateLiteral) {
      return { type: 'string', pattern: `^${toPattern(this.types, type)}$` }
    }

    if (flags & TypeFlags.StringMapping) {
      return { type: 'string' }
    }

    // `object` is also an array, a `Date` (a string), or a function
    if (flags & TypeFlags.NonPrimitive) {
      return {}
    }

    if (type.isUnionType()) {
      return this.convertNullableUnion(type, this.types.getMembers(type))
    }

    if (type.isIntersectionType()) {
      return this.convertIntersection(type, this.types.getMembers(type))
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
    const core =
      concrete.length > 1 && concrete.length < members.length
        ? this.checker.getNonNullableType(type)
        : undefined

    // without `strictNullChecks` the checker returns the union itself
    if (core && core.id !== type.id && !(core.flags & TypeFlags.Never)) {
      const hasNull = members.some((m) => m.flags & TypeFlags.Null)

      // `Json | undefined` inside `type Json = ... | null` is `Json` again
      // only while that union is being converted, an unrelated `boolean | null` is not `Flag`
      const named = this.nullableCores.get(core.id)
      if (named && named.id !== type.id && hasNull && this.defs.isConverting(this.key(named))) {
        return this.visit(named)
      }

      if (hasNull && type.getAliasSymbol() && !this.types.hasMember(type, UNDEFINED_FLAGS)) {
        this.nullableCores.set(core.id, type)
      }

      return withNullBranch(this.visit(core), hasNull)
    }

    return this.convertMembers(members)
  }

  private convertUnion(
    members: readonly Type[],
    convertValue: (value: Type) => JsonSchema = (value) => this.visit(value),
  ): JsonSchema | undefined {
    const strings = new Set<string>()
    const numbers = new Set<number>()
    const booleans = new Set<boolean>()
    const schemas: JsonSchema[] = []

    for (const member of members) {
      if (member.flags & LITERAL_FLAGS && !this.types.getSingleMemberEnum(member)) {
        const value = (member as any).value
        if (member.flags & TypeFlags.StringLiteral) {
          strings.add(value)
        } else if (member.flags & TypeFlags.NumberLiteral) {
          numbers.add(value)
        } else {
          booleans.add(value)
        }
      } else if (!(member.flags & NULLISH_FLAGS)) {
        schemas.push(convertValue(member))
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
    // branded primitives, e.g. `string & { __brand: 'UserId' }`, also through a view of one
    // (`Readonly<UserId> & { extra?: string }`)
    const primitive =
      members.find((m) => m.flags & PRIMITIVE_FLAGS) ??
      members.map((m) => this.getMappedBrandedPrimitive(m)).find((m) => m !== undefined)
    if (primitive) {
      return this.visit(primitive)
    }

    const arrayLike = members.find((m) => this.types.getReferenceKind(m) !== undefined)
    if (arrayLike) {
      // `JSON.stringify` calls `toJSON` of arrays, the serializer walks them
      const toJSONResults =
        this.mode !== 'serializer' ? getToJSONResultTypes(this.types, type, true) : []

      if (!toJSONResults.length) {
        return this.visit(arrayLike)
      }

      const converted = this.convertToJSONResults(toJSONResults)

      if (this.mode === 'stringify') {
        return anyOfDeduped(converted)
      }

      // a `toJSON` returning only `undefined` writes nothing, the walked array remains
      const written = converted.filter((_, i) => !isDropped(this.types, toJSONResults[i]!))
      return anyOfDeduped([...written, this.visit(arrayLike)])
    }

    // `Uint8Array & { label: string }` is written by its index keys and the added fields
    if (isTypedArray(this.types, type)) {
      return this.convertObject(type)
    }

    // branded built-ins, e.g. `Date & { __brand: 'CreatedAt' }`
    for (const member of members) {
      const builtin =
        member.flags & TypeFlags.Object ? this.convertBuiltinObject(member) : undefined
      if (builtin !== undefined) {
        return this.withPlainForm(type, builtin)
      }
    }

    return this.convertObject(type)
  }

  /**
   * `ignoreToJSON` converts the own fields of a type with `toJSON`. `plain` converts a view of a
   * built-in (`Partial<Date>`) as the plain object it may hold. `ownFields` converts a built-in
   * subclass by its own fields, as `JSON.stringify` writes what `toJSON` returned.
   */
  private convertObject(
    type: Type,
    ignoreToJSON = false,
    plain = false,
    ownFields = false,
  ): JsonSchema {
    // a request carries plain JSON, also for a class type. A client may still send an instance
    // of the class behind a view (`Readonly<User>`), written without its getters, or as the
    // built-in the class extends (`Pick<class Stamp extends Date, 'label'>`).
    const sentClass =
      this.input && !plain && !ownFields ? getClassType(this.types, type) : undefined

    if (this.input) {
      plain = true
      ignoreToJSON = true
    }

    // `Readonly<UserId>`, or `DeepReadonly<T>` over `UserId = string & { __brand: 'UserId' }`,
    // maps over the members of the primitive, the value is still the primitive
    const branded = this.getMappedBrandedPrimitive(type)
    if (branded) {
      return this.visit(branded)
    }

    const referenceKind = this.types.getReferenceKind(type)

    if (referenceKind === 'array') {
      return { type: 'array', items: this.visitElement(this.types.getReferenceArguments(type)[0]) }
    }

    if (referenceKind === 'tuple') {
      return this.convertTuple(type as TypeReference)
    }

    const builtin = ownFields ? undefined : this.convertBuiltinObject(type)
    if (builtin !== undefined) {
      return this.withPlainForm(type, builtin)
    }

    // the class behind `Readonly<C>`, `Pick<C, K>`, or `C & { extra }` (`Object.freeze`, `Object.assign`)
    const classType = plain ? undefined : getClassType(this.types, type)

    // a view of a class may hold an instance or a plain object, unless only instances
    // are assignable to it (an interface or intersection over a class with private members),
    // and so may an interface extending a built-in class (`interface AppError extends Error`)
    const isView =
      classType !== undefined
        ? isClassView(this.types, type)
        : !plain && extendsBuiltinClass(this.types, type)

    // the serializer leaves an instance to `JSON.stringify` and walks a plain object,
    // so each value of a view is written by either one
    if (isView && this.mode === 'serializer') {
      return this.withMode('either', () => this.convertObject(type, ignoreToJSON, plain, ownFields))
    }

    // in the either mode, a view is an instance or a plain object, field by field
    // (under `JSON.stringify`, a view is written as an instance)
    const eitherView = isView && this.mode === 'either'
    const sentView = sentClass !== undefined && isClassView(this.types, type)
    const instanceClass = classType ?? sentClass

    if (instanceClass && !ownFields) {
      // of each class behind it (`interface L extends Pick<A, 'id'>, Pick<class B extends Date, 'v'>`)
      const classes = getClassTypes(this.types, type).filter((c) => c.id !== type.id)
      const subclasses = classes
        .map((c) => this.convertBuiltinObject(c))
        .filter((schema): schema is JsonSchema => schema !== undefined)

      if (subclasses.length) {
        // an instance is written as the built-in, a plain object (or an instance of a class
        // extending none) by its fields
        return anyOfDeduped(
          isView || sentView
            ? [...subclasses, this.convertObject(type, ignoreToJSON, true)]
            : subclasses.length < classes.length
              ? [...subclasses, this.convertObject(type, ignoreToJSON, plain, true)]
              : subclasses,
        )
      }
    }

    const properties = this.types.getProperties(type)

    // an instance has its own `toJSON` (also one an intersection adds), or the one of its class,
    // also when a view leaves it out (`Pick<Money, 'cents'>`), of each class a view is over
    // (`interface L extends Pick<A, 'id'>, Pick<B, 'v'>`). `JSON.stringify` also calls
    // the `toJSON` of plain objects, which the serializer skips.
    const stringifyRules = this.mode !== 'serializer'
    const ownToJSON = ignoreToJSON ? [] : getToJSONResultTypes(this.types, type, stringifyRules)

    // a view of a function (`DeepReadonly<(() => number) & { toJSON(): string }>`) may hold the
    // function, which `JSON.stringify` writes by its `toJSON`, or a plain object of its fields
    const viewedFunction =
      ownToJSON.length || ignoreToJSON ? undefined : getViewedFunction(this.types, type)
    const viewedResults =
      viewedFunction && viewedFunction !== type
        ? getToJSONResultTypes(this.types, viewedFunction, true).filter(
            (result) => !isDropped(this.types, result),
          )
        : []

    if (viewedResults.length) {
      return anyOfDeduped([
        ...this.convertToJSONResults(viewedResults),
        this.convertObject(type, true, plain, ownFields),
      ])
    }

    const jsonSources = ownToJSON.length || !classType ? [type] : getClassTypes(this.types, type)
    // of each source, empty when it has no `toJSON`
    const sourceResults = ownToJSON.length
      ? [ownToJSON]
      : ignoreToJSON || !classType
        ? []
        : jsonSources.map((c) => getToJSONResultTypes(this.types, c, stringifyRules))
    const toJSONResults = sourceResults.flat()
    if (toJSONResults.length) {
      const converted = this.convertToJSONResults(toJSONResults)

      const mayLackToJSON =
        sourceResults.some((results) => !results.length) ||
        jsonSources.some((source) => hasOptionalToJSON(this.types, source)) ||
        // the serializer does not walk a function, `JSON.stringify` calls its `toJSON`
        (!isFunction(this.types, type) &&
          (this.mode === 'stringify'
            ? // under `JSON.stringify` rules, a view may also hold a plain object without `toJSON`
              classType !== undefined && classType.id !== type.id
            : // the serializer skips `toJSON` of a plain object, which a declared object type
              // (`interface Point { toJSON(): string }`) or a view of a class may be
              classType === undefined || eitherView || plain))

      if (!mayLackToJSON) {
        return anyOfDeduped(converted)
      }

      // a function without `toJSON` is written as nothing (the caller makes it optional), not
      // as its fields
      if (isFunction(this.types, type)) {
        return anyOfDeduped(converted.filter((_, i) => !isDropped(this.types, toJSONResults[i]!)))
      }

      // without `toJSON`, a value is its own fields, of an instance or (for a view or an interface)
      // of a plain object. A `toJSON` returning only `undefined` writes nothing, the fields remain.
      const fields = this.convertObject(type, true, plain, ownFields)
      return anyOfDeduped([
        ...converted.filter((_, i) => !isDropped(this.types, toJSONResults[i]!)),
        fields,
      ])
    }

    /** Fields written by `JSON.stringify` */
    const isClassInstance = classType !== undefined && !eitherView
    // the class of an instance a value may be, besides a plain object: of a view, also one
    // a client sends, or an interface extending a built-in (`interface AppError extends Error`)
    const viewedClass = eitherView
      ? (classType ?? type)
      : sentView
        ? sentClass
        : !classType && extendsBuiltinClass(this.types, type)
          ? type
          : undefined
    // a plain object also has what an instance does not write: getters (`Readonly<C>` keeps them
    // as properties), and members a class inherits from a built-in (`Error#message`)
    let dataProperties = viewedClass
      ? getDataProperties(this.types, properties, undefined, true)
      : getDataProperties(this.types, properties, isClassInstance ? classType : undefined)
    // what an instance writes, which a client may also send for the class itself
    // (not the `size` a `URLSearchParams` inherits)
    const writingClass = viewedClass ?? sentClass
    const instanceProperties = writingClass
      ? new Set(getDataProperties(this.types, properties, writingClass))
      : undefined

    if (
      dataProperties.length === 0 &&
      this.checker.getSignaturesOfType(type, SignatureKind.Call).length
    ) {
      // functions are not serializable
      return {}
    }

    // the empty object type `{}` (also `NonNullable<unknown>`) accepts any value but `null` and `undefined`
    if (
      !properties.length &&
      !classType &&
      !isObjectLiteral(type) &&
      !this.checker.getIndexInfosOfType(type).length &&
      !this.checker.getSignaturesOfType(type, SignatureKind.Construct).length
    ) {
      return {}
    }

    // a typed array (`class Bytes extends Uint8Array`, `Partial<Buffer>` without `toJSON`)
    // is written by its index keys, and by the fields it adds
    const form = this.typedArrayForms.get(type.id)
    const typedArray = form !== 'plain' && isTypedArray(this.types, type)
    let arrayLike: { schema: JsonSchema; only: boolean } | undefined

    // an interface over a view of a typed array (`interface Buf extends Pick<Uint8Array, 'buffer'>`)
    // may also be a plain object, written by the fields of the view, unless the index keys cover them
    if (typedArray && form === undefined && this.mayHoldPlainFields(type)) {
      const convertForm = (next: 'typed' | 'plain') => {
        this.typedArrayForms.set(type.id, next)
        try {
          return this.convertObject(type, ignoreToJSON, plain, ownFields)
        } finally {
          this.typedArrayForms.delete(type.id)
        }
      }

      return anyOfDeduped([convertForm('typed'), convertForm('plain')])
    }

    if (typedArray) {
      dataProperties = dataProperties.filter((p) => !isBuiltinMember(this.types, p))
    } else if (!((plain || eitherView) && this.isViewOfArraySubclass(type))) {
      // (a plain object of `Partial<class Rows extends Array>` holds the fields, not items)
      arrayLike = this.convertArrayLikeObject(type, properties)
      if (arrayLike?.only) {
        return arrayLike.schema
      }
    }

    // the serializer leaves a typed array (`Uint8Array & { tags: Set<string> }`) to `JSON.stringify`,
    // as an instance
    const stringified = isClassInstance || (typedArray && !this.input && !eitherView)
    const fieldsMode: ConversionMode = stringified ? 'stringify' : this.mode
    const convertValue = (value: Type) =>
      stringified ? this.visitInClassInstance(value) : this.visit(value)

    const schema: ObjectJsonSchema & { properties: Record<string, JsonSchema> } = {
      type: 'object',
      properties: {},
    }
    const required: string[] = []

    const propertyTypes = this.types.getSymbolTypes(dataProperties)

    for (let i = 0; i < dataProperties.length; i++) {
      const property = dataProperties[i]!
      const propertyType = propertyTypes[i]

      // functions, symbols, and always `undefined` values are dropped by JSON serialization,
      // also when `toJSON` returns them (in either mode, when the serializer calls it too)
      const serialized =
        !this.input && propertyType
          ? getToJSONResultTypes(this.types, propertyType, fieldsMode === 'stringify')
          : []
      if (
        !propertyType ||
        isDropped(this.types, propertyType) ||
        (serialized.length &&
          serialized.every((result) => isDropped(this.types, result)) &&
          !this.mayLackToJSON(propertyType, fieldsMode))
      ) {
        continue
      }

      // `string | (() => void)`: JSON serialization drops the key when it holds a function
      const serializable = this.getSerializableMembers(propertyType)

      let propertySchema = serializable
        ? this.convertMembers(serializable, convertValue)
        : convertValue(this.getNullableAliasType(property, propertyType) ?? propertyType)

      // an alias of a primitive or literal (`type Count = number`) leaves no trace in the type,
      // so its JSDoc is read through the property's type annotation
      if (isTrivialSchema(propertySchema) || isLiteralSchema(propertySchema)) {
        propertySchema = this.annotate(
          propertySchema,
          this.getAnnotationAlias(property, propertyType),
        )
      }

      // a `__proto__` key must be an own property, not the object's prototype
      setOwn(schema.properties, property.name, this.annotate(propertySchema, property))

      if (
        !serializable &&
        // fields added to a typed array by an intersection may be phantom brands
        !(
          typedArray &&
          (type.isIntersectionType() || this.types.getMappedSourceMembers(type).length > 1)
        ) &&
        !(property.flags & SymbolFlags.Optional) &&
        !this.isOptional(propertyType) &&
        !this.mayDropThroughToJSON(propertyType, fieldsMode !== 'serializer') &&
        // an instance does not write a getter
        (!instanceProperties || instanceProperties.has(property))
      ) {
        required.push(property.name)
      }
    }

    if (required.length) {
      schema.required = required
    }

    this.convertIndexSignatures(type, schema, convertValue)

    if (typedArray) {
      schema.additionalProperties ??= { type: 'number' }
    }

    // an instance behind a view also writes the fields the view leaves out, like the private ones
    // (`Readonly<class Bytes extends Uint8Array { private secret }>`), which the index keys do not cover
    if (
      schema.additionalProperties !== undefined &&
      classType &&
      classType.id !== type.id &&
      getDataProperties(this.types, this.types.getProperties(classType), classType).some(
        (p) => !Object.hasOwn(schema.properties, p.name),
      )
    ) {
      delete schema.additionalProperties
    }

    if (!Object.keys(schema.properties).length) {
      delete (schema as ObjectJsonSchema).properties
    }

    // an array-like view may also hold a plain object
    return arrayLike ? anyOfDeduped([arrayLike.schema, schema]) : schema
  }

  /**
   * A string (or number) index covers every key, narrower template literal keys add nothing.
   * Branded keys (`Record<UserId, User>`) are keys of their primitive or template.
   */
  private convertIndexSignatures(
    type: Type,
    schema: ObjectJsonSchema & { properties: Record<string, JsonSchema> },
    convertValue: (value: Type) => JsonSchema,
  ): void {
    // like properties, functions and symbols are dropped (`Record<string, string | (() => void)>`)
    const convertEntry = (value: Type) => {
      const serializable = this.getSerializableMembers(value)
      return serializable ? this.convertMembers(serializable, convertValue) : convertValue(value)
    }

    const keys = this.checker.getIndexInfosOfType(type).map((info) => ({
      info,
      key: getIndexKeyType(this.types, info.keyType),
    }))
    const anyKey =
      keys.find(({ key }) => key && key.flags & TypeFlags.String) ??
      keys.find(({ key }) => key && key.flags & TypeFlags.Number)
    const patternKeys = keys.filter(
      ({ key }) => key && key.flags & (TypeFlags.TemplateLiteral | TypeFlags.StringMapping),
    )

    if (anyKey) {
      schema.additionalProperties = convertEntry(anyKey.info.valueType)
    } else if (patternKeys.length === 1 && !Object.keys(schema.properties).length) {
      // like zod records with template literal keys, which keeps the value type in OpenAPI 3.0
      schema.propertyNames = {
        type: 'string',
        pattern: `^${toPattern(this.types, patternKeys[0]!.key!)}$`,
      }
      schema.additionalProperties = convertEntry(patternKeys[0]!.info.valueType)
    } else {
      for (const { info, key } of patternKeys) {
        schema.patternProperties ??= {}
        setOwn(
          schema.patternProperties,
          `^${toPattern(this.types, key!)}$`,
          convertEntry(info.valueType),
        )
      }
    }
  }

  private convertTuple(type: TypeReference): JsonSchema {
    const target = type.getTarget() as Type & { elementFlags?: readonly ElementFlags[] }
    const elementFlags = target.elementFlags ?? []
    const elements = this.types.getReferenceArguments(type).slice(0, elementFlags.length)

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
    // a boxed `BigInt` is no bigint to the serializer, it leaves it to `JSON.stringify`
    if (this.mode === 'either' || (this.mode === 'serializer' && isBoxedBigInt(this.types, type))) {
      return this.convertEitherBuiltinObject(type)
    }

    return this.convertWrittenBuiltinObject(type)
  }

  /**
   * A built-in as the serializer, or under `JSON.stringify`, writes it.
   */
  private convertWrittenBuiltinObject(type: Type): JsonSchema | undefined {
    const builtin = getBuiltin(this.types, type, this.mode === 'stringify')

    switch (builtin?.kind) {
      case 'schema':
        return builtin.schema
      case 'array':
        return { type: 'array', items: this.visitElement(builtin.items) }
      case 'set':
        return setSchema(this.visitElements(builtin.items))
      case 'map':
        return mapSchema({
          type: 'array',
          prefixItems: [this.visitElement(builtin.key), this.visitElement(builtin.value)],
          maxItems: 2,
          minItems: 2,
        })
      case 'map-entries':
        return mapSchema(this.visitElements(builtin.entries))
      case 'typed-array':
        // `JSON.stringify` writes the items, also of a request, a `bigint` only by a polyfilled `toJSON`
        return {
          type: 'object',
          additionalProperties: builtin.items
            ? this.withMode('stringify', () => this.visit(builtin.items!))
            : { type: 'number' },
        }
    }

    return undefined
  }

  /**
   * A built-in written by the serializer or by `JSON.stringify`, like a `Set` as an array or `{}`.
   * When only one of them handles it (`JSON.stringify` calls `toJSON` of a built-in subclass),
   * the other form is the conversion of the object.
   */
  private convertEitherBuiltinObject(type: Type): JsonSchema | undefined {
    const modes = ['serializer', 'stringify'] as const
    const builtins = modes.map((mode) =>
      this.withMode(mode, () => this.convertWrittenBuiltinObject(type)),
    )

    if (builtins.every((builtin) => builtin === undefined)) {
      return undefined
    }

    const forms = builtins.map(
      (builtin, i) =>
        builtin ?? this.withMode(modes[i]!, () => this.convertObject(type, false, false, true)),
    )
    // a boxed `BigInt` can not be written by `JSON.stringify`
    const writable = forms.filter((form) => !isNeverSchema(form))

    return writable.length ? anyOfDeduped(writable) : forms[0]!
  }

  /**
   * An object type derived from an array or tuple, like type-fest's `FixedLengthArray<T, 3>`
   * (a tuple without its length mutating methods), whose values are still arrays, `only` unless
   * it may also hold a plain object: when a view makes `length` optional (`Partial<[number] & X>`),
   * widens it (`{ [K in keyof T]: T[K] | string }`), or leaves it or `slice` out
   * (`Pick<[number, string], 0>`).
   */
  private convertArrayLikeObject(
    type: Type,
    properties: readonly TSSymbol[],
  ): { schema: JsonSchema; only: boolean } | undefined {
    const slice = properties.find((p) => p.name === 'slice')
    // the `slice` of an array, not of a string (`Partial<class Tag extends String>`)
    const keptSlice = slice !== undefined && this.isArrayMember(slice)
    const source = keptSlice ? undefined : this.types.getMappedSource(type)
    const viewed = source && this.types.getReferenceKind(source) !== undefined ? source : undefined
    const length =
      properties.find((p) => p.name === 'length') ??
      (viewed && this.types.getProperty(viewed, 'length'))

    if (!length || (!keptSlice && !viewed)) {
      return undefined
    }

    const numeric = properties.filter((p) => /^\d+$/u.test(p.name))
    // in index order, `0`, `1`, ...
    const elements = numeric.map((_, i) => numeric.find((p) => p.name === String(i)))
    const ordered = elements.every((e) => e !== undefined) ? (elements as TSSymbol[]) : numeric
    const [lengthType, ...elementTypes] = this.checker.getTypeOfSymbol([length, ...ordered])
    // `Partial` makes the length optional, a tuple with optional elements has several
    // (`1 | 2` of `Readonly<[number, string?] & { extra?: string }>`)
    const members = lengthType
      ? lengthType.isUnionType()
        ? this.types.getMembers(lengthType)
        : [lengthType]
      : []
    const lengths = members.filter((t) => t.flags & TypeFlags.NumberLike)

    // a mapped type changing the values (`{ [K in keyof T]?: true }`) is no array
    if (!lengths.length) {
      return undefined
    }

    const only =
      keptSlice &&
      !((length.flags | slice.flags) & SymbolFlags.Optional) &&
      lengths.length === members.length
    const array = (schema: JsonSchema) => ({ schema, only })

    const fixed = lengths.every((t) => t.flags & TypeFlags.NumberLiteral)
      ? lengths.map((t) => (t as any).value as number)
      : undefined

    // an element a view leaves out (`Pick<[number, string], 0 | 'length' | 'slice'>`) is still
    // there, of any type
    const byIndex = new Map(ordered.map((p, i) => [Number(p.name), elementTypes[i]!]))
    const prefixItems = (count: number) =>
      Array.from({ length: count }, (_, i): JsonSchema => {
        const element = byIndex.get(i)
        return element ? this.visitElement(element) : {}
      })

    const count = byIndex.size ? Math.max(...byIndex.keys()) + 1 : 0

    if (fixed !== undefined && count <= Math.max(...fixed)) {
      return array({
        type: 'array',
        prefixItems: prefixItems(Math.max(...fixed)),
        minItems: Math.min(...fixed),
        maxItems: Math.max(...fixed),
      })
    }

    // the number index of an array or a rest tuple (`Readonly<[number, ...string[]] & { x }>`)
    // holds every item, after the leading elements of a tuple
    const index = getNumberIndexType(this.types, type)

    if (index) {
      const leading = ordered === elements ? ordered : []
      const minItems = leading.filter((p) => !(p.flags & SymbolFlags.Optional)).length

      return array({
        type: 'array',
        ...(leading.length
          ? { prefixItems: elementTypes.slice(0, leading.length).map((t) => this.visitElement(t)) }
          : {}),
        items: this.visitElement(index),
        ...(minItems ? { minItems } : {}),
      })
    }

    // without a number index, the items after the elements are unknown
    return array(count ? { type: 'array', prefixItems: prefixItems(count) } : { type: 'array' })
  }

  /**
   * Whether a property is the declaration of an array's member, also through a mapped type.
   */
  private isArrayMember(property: TSSymbol): boolean {
    const declaration = property.declarations[0]

    return (
      declaration !== undefined &&
      ['Array', 'ReadonlyArray'].some((name) => {
        const global = this.types.getGlobalType(name)
        const own = global && this.checker.getPropertyOfType(global, property.name)?.declarations
        return own?.some((d) => d.path === declaration.path && d.index === declaration.index)
      })
    )
  }

  /**
   * The members of a union JSON serialization keeps, when it also has functions or symbols.
   */
  private getSerializableMembers(type: Type): readonly Type[] | undefined {
    if (!type.isUnionType()) {
      return undefined
    }

    const members = this.types.getMembers(type)
    const serializable = members.filter((m) => !isNonSerializable(this.types, m))

    return serializable.length < members.length ? serializable : undefined
  }

  /**
   * Converts some members of a union, `null` adds a `null` branch and `undefined` is left out.
   */
  private convertMembers(
    members: readonly Type[],
    convertValue?: (value: Type) => JsonSchema,
  ): JsonSchema {
    return withNullBranch(
      this.convertUnion(members, convertValue),
      members.some((m) => m.flags & TypeFlags.Null),
    )
  }

  /**
   * Items of several types, like a `Set` subclass iterating strings and numbers.
   */
  private visitElements(items: readonly (Type | undefined)[]): JsonSchema {
    const schemas = dedupe(items.map((item) => this.visitElement(item)))
    return schemas.length > 1 ? { anyOf: schemas } : (schemas[0] ?? {})
  }

  /**
   * Array items and tuple elements serialize `undefined` as `null`.
   */
  private visitElement(type: Type | undefined): JsonSchema {
    if (!type) {
      return {}
    }

    // functions and symbols in arrays are serialized as `null`
    if (type.flags & UNDEFINED_FLAGS || isNonSerializable(this.types, type)) {
      return { type: 'null' }
    }

    const serializable = this.getSerializableMembers(type)
    if (serializable) {
      return withNullBranch(this.convertUnion(serializable), true)
    }

    const schema = this.visit(type)

    // `JSON.stringify` writes an item whose `toJSON` returns `undefined` (or a function) as `null`
    if (this.mayDropThroughToJSON(type, this.mode !== 'serializer')) {
      return withNull(schema)
    }

    return this.types.hasMember(type, UNDEFINED_FLAGS) &&
      !this.types.hasMember(type, TypeFlags.Null)
      ? withNull(schema)
      : schema
  }

  /**
   * What `JSON.stringify` writes of each result of `toJSON`.
   */
  private convertToJSONResults(results: readonly Type[]): JsonSchema[] {
    return this.withMode('stringify', () =>
      results.map((result) => this.convertToJSONResult(result)),
    )
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

    // each member of `Date | string` or `this | null` is serialized once, by its own fields
    if (resolved.isUnionType()) {
      const members = this.types.getMembers(resolved)

      if (
        !members.some(
          (m) => m.flags & (TypeFlags.Object | TypeFlags.Intersection | TypeFlags.TypeParameter),
        )
      ) {
        return this.visit(resolved)
      }

      // functions and symbols are dropped like `undefined`
      const schemas = dedupe(
        members
          .filter((m) => !(m.flags & NULLISH_FLAGS) && !isNonSerializable(this.types, m))
          .map((m) => this.convertToJSONResult(m)),
      )

      return withNullBranch(
        schemas.length > 1 ? { anyOf: schemas } : schemas[0],
        members.some((m) => m.flags & TypeFlags.Null),
      )
    }

    if (
      !(resolved.flags & (TypeFlags.Object | TypeFlags.Intersection)) ||
      this.types.getReferenceKind(resolved) !== undefined
    ) {
      return this.visit(resolved)
    }

    // a typed array by its index keys and the fields it adds, a subclass of another built-in
    // (`class MyDate extends Date`, also `Readonly<MyDate>` or `MyDate & { x }`) by its own fields
    const typedArray = isTypedArray(this.types, resolved)
    const classType = getClassType(this.types, resolved)

    // a subclass of a boxed primitive (`class Tag extends String`) is written as its primitive
    const boxed = classType && getBoxedPrimitiveSchema(this.types, classType)
    if (boxed) {
      return boxed
    }

    if (typedArray || (classType && getBuiltinBaseName(this.types, classType) !== undefined)) {
      return this.convertObject(resolved, true, false, !typedArray)
    }

    // a branded value is serialized as its base: the primitive of `string & { __brand: 'Id' }`,
    // the items of `number[] & { ... }`, or the own fields of `Date & { ... }`
    if (resolved.isIntersectionType()) {
      const members = this.types.getMembers(resolved)

      if (members.some((m) => m.flags & PRIMITIVE_FLAGS)) {
        return this.visit(resolved)
      }

      const base = members.find(
        (m) =>
          this.types.getReferenceKind(m) !== undefined ||
          getBuiltinFields(this.types, m) !== undefined,
      )

      if (base) {
        return this.convertToJSONResult(base)
      }
    }

    // a returned built-in is written by its own fields, also through `Readonly<Date>`
    return getBuiltinFields(this.types, resolved) ?? this.convertObject(resolved, true)
  }

  /**
   * What a polyfilled `BigInt.prototype.toJSON` returns, declared with
   * `declare global { interface BigInt { toJSON(): string } }`.
   */
  private getBigIntToJSONResultTypes(): readonly Type[] {
    const bigint = this.types.getGlobalType('BigInt')
    return bigint ? getToJSONResultTypes(this.types, bigint, true) : []
  }

  /**
   * A built-in, or also the plain object a view of it may hold (`Partial<Date>`,
   * `Pick<URL, 'href'> & { x: number }`), in a request too: a client holding a `Date` sends its string.
   */
  private withPlainForm(type: Type, builtin: JsonSchema): JsonSchema {
    if (!this.mayHoldPlainObject(type)) {
      return builtin
    }

    // an instance of a class besides the built-in (`Holder & Pick<Date, 'getTime'>`) is written by its
    // fields too, of a view of the class
    const classView = getClassTypes(this.types, type).some((c) => !hasBuiltinForm(this.types, c))
    const fields = this.convertObject(type, true, !classView, true)

    // `JSON.stringify` writes a `Set` as `{}`, which also covers its plain object
    return isPlain(builtin, 'object') && typeof fields === 'object' && fields.type === 'object'
      ? builtin
      : anyOfDeduped([builtin, fields])
  }

  /**
   * Whether a mapped view of a built-in or class may hold a plain object: it makes members
   * optional (`Partial<Date>`) or leaves some out (`Pick<URL, 'href'>`), also in an intersection,
   * and any view of a primitive, whose few members a plain object easily has
   * (`{ valueOf: () => true }` of `Omit<boolean, 'k'>`).
   */
  private mayHoldPlainObject(type: Type): boolean {
    if (type.isIntersectionType()) {
      return this.types.getMembers(type).some((m) => this.mayHoldPlainObject(m))
    }

    // an interface extending a view of a built-in (`interface Link extends Pick<URL, 'href'>`)
    const views = getViewBases(type)
    if (views.length) {
      return views.some((view) => this.mayHoldPlainObject(view))
    }

    // the members of an intersection a conditional mapped type maps over, which it has no trace of
    const source = this.types.getMappedSource(type)
    const sources = source ? [source] : this.types.getMappedSourceMembers(type)

    if (!sources.length) {
      return false
    }

    const sourceProperties = new Map(
      sources.flatMap((s) => this.types.getProperties(s)).map((p) => [p.name, p]),
    )
    const properties = this.types.getProperties(type)

    return (
      this.types.isPrimitiveView(type) ||
      // the source may hold one (`Readonly<Link>` of `interface Link extends Pick<URL, 'href'>`)
      sources.some((s) => getViewBases(s).some((view) => this.mayHoldPlainObject(view))) ||
      properties.length < sourceProperties.size ||
      properties.some(
        (p) =>
          p.flags & SymbolFlags.Optional &&
          !((sourceProperties.get(p.name)?.flags ?? 0) & SymbolFlags.Optional),
      )
    )
  }

  /**
   * The branded primitive (`string & { __brand: 'UserId' }`) a mapped type maps over by its keys,
   * which a homomorphic mapped type keeping its values (`Readonly<T>`, `DeepReadonly<T>`) does not
   * change at runtime. One changing them (`{ [K in keyof T]?: true }`) is an object.
   */
  private getMappedBrandedPrimitive(type: Type): Type | undefined {
    if (!((type as any).objectFlags & ObjectFlags.Mapped)) {
      return undefined
    }

    const keys = new Set(this.types.getProperties(type).map((p) => p.name))
    const source = this.types.getMappedSource(type)

    return [...(source ? [source] : []), ...this.types.getTypeArguments(type)].find((candidate) => {
      if (
        !candidate.isIntersectionType() ||
        !this.types.getMembers(candidate).some((m) => m.flags & PRIMITIVE_FLAGS)
      ) {
        return false
      }

      const candidateKeys = this.types.getProperties(candidate)
      return (
        candidateKeys.length === keys.size &&
        candidateKeys.every((p) => keys.has(p.name)) &&
        this.types.isMappedViewOf(type, candidate)
      )
    })
  }

  /**
   * Whether a plain object of an interface over a view of a typed array has fields its index keys
   * do not cover: of the view, ones JSON writes as something else than a number (`buffer`).
   */
  private mayHoldPlainFields(type: Type): boolean {
    return getTypedArrayViewBases(this.types, type).some((view) => {
      const properties = this.types.getProperties(view)
      const propertyTypes = properties.length ? this.checker.getTypeOfSymbol([...properties]) : []

      return propertyTypes.some(
        (t) =>
          t !== undefined &&
          !isDropped(this.types, t) &&
          (t.isUnionType() ? this.types.getMembers(t) : [t]).some(
            (m) => !(m.flags & (TypeFlags.NumberLike | UNDEFINED_FLAGS)),
          ),
      )
    })
  }

  private isViewOfArraySubclass(type: Type): boolean {
    if (type.isIntersectionType()) {
      return this.types.getMembers(type).some((m) => this.isViewOfArraySubclass(m))
    }

    const source = this.types.getMappedSource(type)
    const base = source && getBuiltinBaseName(this.types, source)
    return base === 'Array' || base === 'ReadonlyArray'
  }

  /**
   * Whether a value of this type may be written without calling its `toJSON`: the method is
   * optional, or the serializer may walk it as a plain object (a declared object type like
   * `interface Point { toJSON(): string }`, or a view of a class), skipping `toJSON`.
   */
  private mayLackToJSON(type: Type, mode: ConversionMode): boolean {
    if (hasOptionalToJSON(this.types, type)) {
      return true
    }

    if (mode === 'stringify') {
      return false
    }

    return getClassType(this.types, type) === undefined || isClassView(this.types, type)
  }

  /**
   * Whether `toJSON` of a value of this type, or of a union member, may return what JSON
   * leaves out: `undefined`, a function, or a symbol. The key is then dropped, and an item `null`.
   */
  private mayDropThroughToJSON(type: Type, stringify: boolean): boolean {
    const members = type.isUnionType() ? this.types.getMembers(type) : [type]

    return members.some((member) => {
      // a function without its optional `toJSON` is dropped, also by a client sending it
      if (mayBeNonSerializable(this.types, member)) {
        return true
      }

      // the server decodes plain JSON, it calls no `toJSON`
      if (this.input) {
        return false
      }

      // also of the classes behind a view leaving `toJSON` out (`Omit<C, 'toJSON'>`)
      const own = getToJSONResultTypes(this.types, member, stringify)
      const results = own.length
        ? own
        : getClassTypes(this.types, member).flatMap((c) =>
            getToJSONResultTypes(this.types, c, stringify),
          )
      return results.some(
        (serialized) =>
          this.isOptional(serialized) ||
          isNonSerializable(this.types, serialized) ||
          this.getSerializableMembers(serialized) !== undefined,
      )
    })
  }

  /**
   * The def name of an anonymous view of a project class, like `Readonly<User>` or `User & { x }`.
   */
  private getViewDefName(type: Type): string | undefined {
    if (!(type.flags & (TypeFlags.Object | TypeFlags.Intersection))) {
      return undefined
    }

    const classType = getClassType(this.types, type)
    const classSymbol = classType?.getSymbol()

    return classType &&
      classSymbol &&
      classType.id !== type.id &&
      this.types.getSymbolSourceKind(classSymbol) === 'project'
      ? getViewDefName(this.types, type, classSymbol)
      : undefined
  }

  /**
   * Converts a value of a class instance, which `JSON.stringify` serializes. Converted again
   * under its rules only when they make a difference, so shared models keep one def.
   */
  private visitInClassInstance(type: Type): JsonSchema {
    return this.mode === 'stringify' || !this.stringifySensitivity.isSensitive(type)
      ? this.visit(type)
      : this.withMode('stringify', () => this.visit(type))
  }

  /**
   * Keys of conversion results, which differ between the modes.
   */
  private key(type: Type): number {
    if (this.mode === 'serializer') {
      return type.id
    }

    // a type converted the same way as under the serializer shares its result, and so its def
    const sensitivity =
      this.mode === 'stringify' ? this.stringifySensitivity : this.eitherSensitivity
    return sensitivity.isSensitive(type) ? toModeKey(type.id, this.mode) : type.id
  }

  private withMode<T>(mode: ConversionMode, fn: () => T): T {
    const previous = this.mode
    this.mode = mode
    try {
      return fn()
    } finally {
      this.mode = previous
    }
  }

  private annotate(schema: JsonSchema, symbol: TSSymbol | undefined): JsonSchema {
    if (!symbol || typeof schema !== 'object') {
      return schema
    }

    const jsdoc = this.types.getJSDoc(symbol)

    return jsdoc ? applyJSDoc(schema, jsdoc.comment, jsdoc.tags) : schema
  }

  /**
   * `status?: Status` with `type Status = 'open' | null` has the type `'open' | null | undefined`,
   * which no longer carries the alias, and stripping `undefined` through the checker also strips
   * `null`. The alias type of the annotation keeps the def and its JSDoc, when it is the same type.
   */
  private getNullableAliasType(property: TSSymbol, type: Type): Type | undefined {
    if (
      !this.types.hasMember(type, UNDEFINED_FLAGS) ||
      !this.types.hasMember(type, TypeFlags.Null)
    ) {
      return undefined
    }

    const annotated = this.types.getAnnotation(property)?.type

    if (
      !annotated?.isUnionType() ||
      !this.types.hasMember(annotated, TypeFlags.Null) ||
      this.types.hasMember(annotated, UNDEFINED_FLAGS)
    ) {
      return undefined
    }

    const ids = (t: Type) =>
      new Set(
        this.types
          .getMembers(t)
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
    const annotation = this.types.getAnnotation(property)

    if (!annotation) {
      return undefined
    }

    const members = type.isUnionType() ? this.types.getMembers(type) : [type]

    return annotation.type.id === type.id || members.some((m) => m.id === annotation.type.id)
      ? annotation.alias
      : undefined
  }
}

/**
 * One schema, or `anyOf` of the different ones, flattening nested `anyOf`.
 */
function anyOfDeduped(schemas: readonly JsonSchema[]): JsonSchema {
  const flat = dedupe(
    schemas.flatMap((s) =>
      typeof s === 'object' && s.anyOf && Object.keys(s).length === 1 ? s.anyOf : [s],
    ),
  )
  return flat.length === 1 ? flat[0]! : { anyOf: flat }
}

function isNeverSchema(schema: JsonSchema): boolean {
  return (
    typeof schema === 'object' &&
    Object.keys(schema).length === 1 &&
    typeof schema.not === 'object' &&
    Object.keys(schema.not).length === 0
  )
}

/**
 * A schema with a `null` branch when the type has a `null` member, `{}` when nothing is left.
 */
function withNullBranch(schema: JsonSchema | undefined, hasNull: boolean): JsonSchema {
  if (!hasNull) {
    return schema ?? {}
  }

  return schema === undefined ? { type: 'null' } : withNull(schema)
}

/**
 * The key type of an index signature, the primitive or template of a branded key.
 */
function getIndexKeyType(types: TypeQueries, key: Type): Type | undefined {
  const keyFlags =
    TypeFlags.String | TypeFlags.Number | TypeFlags.TemplateLiteral | TypeFlags.StringMapping

  if (key.flags & keyFlags) {
    return key
  }

  return key.isIntersectionType()
    ? types.getMembers(key).find((member) => member.flags & keyFlags)
    : undefined
}

/**
 * The regular expression of the strings a template literal (or its parts) accepts.
 * The checker folds literal parts (`${null}`, `${true}`) into the texts and distributes
 * unions (`${boolean}`, `${'a' | 'b'}`) over the template, branded literals remain.
 */
function toPattern(types: TypeQueries, type: Type): string {
  const flags = type.flags

  if (flags & (LITERAL_FLAGS | TypeFlags.BigIntLiteral)) {
    return escapeRegExp(String((type as any).value))
  }

  // what TypeScript accepts: non-empty strings whose `+s` is finite, so also hexadecimal, octal,
  // and binary literals, with whitespace around, and only whitespace (`+' '` is `0`)
  if (flags & TypeFlags.Number) {
    return '(?:\\s+|\\s*(?:[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?|0[xX][\\da-fA-F]+|0[oO][0-7]+|0[bB][01]+)\\s*)'
  }

  // integer literals, also hexadecimal, octal, and binary ones, without whitespace or `+`
  if (flags & TypeFlags.BigInt) {
    return '-?(?:\\d+|0[xX][\\da-fA-F]+|0[oO][0-7]+|0[bB][01]+)'
  }

  if (flags & TypeFlags.TemplateLiteral) {
    const template = type as TemplateLiteralType
    const parts = types.getMembers(template)
    let pattern = escapeRegExp(template.texts[0] ?? '')
    for (let i = 0; i < parts.length; i++) {
      pattern += toPattern(types, parts[i]!) + escapeRegExp(template.texts[i + 1] ?? '')
    }
    return pattern
  }

  if (type.isIntersectionType()) {
    const primitive = types.getMembers(type).find((m) => m.flags & PRIMITIVE_FLAGS)
    if (primitive) {
      return toPattern(types, primitive)
    }
  }

  // `.` does not match line terminators
  return '[\\s\\S]*'
}
