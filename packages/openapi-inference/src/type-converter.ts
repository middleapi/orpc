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
  addsOwnToJSON,
  extendsBuiltinClass,
  extendsBuiltinView,
  getBuiltin,
  getBodyMediaType,
  getBuiltinBaseName,
  getBuiltinFields,
  getExtendedPrimitiveSchema,
  getIndexInfos,
  getNodeBuffer,
  getNumberIndexType,
  getSatisfyingCollections,
  getSatisfyingTypedArrays,
  getStringifiedForm,
  getTypedArrayViewBases,
  getViewBases,
  getViewParts,
  getViewSources,
  hasBuiltinForm,
  hasToJSONOf,
  isBoxedBigInt,
  isBoxedPrimitive,
  isSentAsString,
  isTypedArray,
} from './builtins'
import type { DefNameRecord } from './components'
import { getDefName, getFallbackDefName, getViewDefName } from './def-names'
import type { ConversionMode } from './defs'
import { DefNames, DefRegistry, toModeKey, toParameterKey } from './defs'
import { ExpansionGuard } from './expansion'
import {
  getClassType,
  isBuiltinMember,
  getClassTypes,
  getDataProperties,
  getToJSONResultTypes,
  getViewedFunction,
  getWrittenToJSONResultTypes,
  hasOptionalToJSON,
  isAnyRecord,
  isLooseIntersection,
  isDropped,
  isDroppedResult,
  isEffectValue,
  isInstanceOrPlain,
  mayBePlainObject,
  isFunction,
  isNonSerializable,
  mayBeNonSerializable,
} from './json-rules'
import { ModeSensitivity } from './mode-sensitivity'
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
  withDiscriminators,
  withNull,
  writtenForm,
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
export class TypeScriptTypeResolutionError extends TypeError {
  /** The files declaring the types and properties the conversion went through to reach it */
  readonly files: Set<string> = new Set()

  addDeclarations(symbol: TSSymbol | undefined): void {
    for (const declaration of symbol?.declarations ?? []) {
      this.files.add(declaration.path)
    }
  }
}

export interface TypeToJsonSchemaConverterOptions {
  /**
   * Which named types become `$defs` (and so OpenAPI components).
   *
   * - `named`: interfaces, classes, enums, and type aliases (other than aliases of primitives and aliases the compiler does not keep, like `type PartialUser = Partial<User>`) declared outside `node_modules` and the default library.
   * - `recursive`: only types that reference themselves, which can not be inlined. Every other type is inlined at each use, so models shared across many levels can make the document much larger.
   *
   * @default 'named'
   */
  defs?: 'named' | 'recursive' | undefined

  /**
   * Which values the schemas describe:
   *
   * - `output`: values the server sends, serialized by oRPC's OpenAPI JSON serializer, which
   *   leaves class instances to `JSON.stringify`.
   * - `input`: values a client sends, so class types are instances or plain objects.
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

  /**
   * With `inlineRoot`, the root properties whose fields are sent each on their own, like `query`
   * and `headers` of a detailed input: when one may be missing, so may each of its fields.
   */
  partialProperties?: readonly string[] | undefined

  /**
   * Describe the value a `Promise` type resolves to, like a handler's result or a yielded value.
   * Set `false` for values that are not awaited, like an error's `data` or an input a client sends,
   * where a promise is `{}`.
   *
   * @default true
   */
  awaited?: boolean | undefined

  /**
   * Describe the value as a whole request or response body, which oRPC sends as is when it is a
   * `ReadableStream`, `FormData`, or `URLSearchParams`: as binary data of its media type.
   *
   * @default false
   */
  body?: boolean | undefined

  /**
   * Describe the `body` property of the root (or of each root union member) as a whole body (see
   * `body`), like that of a detailed input or output.
   *
   * @default false
   */
  bodyProperty?: boolean | undefined

  /**
   * Describe the values of the root's properties (`true`), or of some of them (like `params` and
   * `query` of a detailed input, see `ParameterFields`), as parameters a client sends in the URL,
   * with bracket notation (`?a[b]=...`): typed arrays, `RegExp`, and other values the serializer
   * leaves as they are, are sent as `String(value)`.
   *
   * @default false
   */
  parameters?: boolean | ParameterFields | undefined
}

/**
 * The fields of an object holding parameters (see `TypeToJsonSchemaConvertOptions.parameters`):
 * all of them but `except`, or only those of `only`, each one whole (`true`) or by its own fields.
 * The fields of a plain object only, else none of them.
 */
export interface ParameterFields {
  /** The fields holding parameters, the others do not */
  readonly only?: Readonly<Record<string, true | ParameterFields>> | undefined
  /** The fields not sent with bracket notation, like those of a query style (`'json'`) */
  readonly except?: readonly string[] | undefined
}

export interface AsyncIteratorTypes {
  /** The yielded values, a union of these types */
  yieldTypes: readonly Type[]
  /** The returned values, a union of these types, empty when it returns nothing */
  returnTypes: readonly Type[]
}

/**
 * Which form of an object type `convertObject` writes.
 */
interface ObjectForm {
  /** Converts the own fields of a type with `toJSON`, as if it had none */
  ignoreToJSON?: boolean
  /** Converts a view of a built-in (`Partial<Date>`) as the plain object it may hold */
  plain?: boolean
  /** Converts a built-in subclass by its own fields, as `JSON.stringify` writes what `toJSON` returned */
  ownFields?: boolean
  /** Converts the `body` property as a whole body (see `TypeToJsonSchemaConvertOptions.body`) */
  bodyProperty?: boolean
}

const SHARED = new WeakMap<Checker, { types: TypeQueries; names: DefNames }>()

/**
 * The binary data of each media type a whole body of these types is sent as, as is, and the
 * types written otherwise, also a view of a body built-in, which may be a plain object.
 */
function splitBodies(
  types: TypeQueries,
  members: readonly Type[],
): { sent: JsonSchema[]; others: Type[] } {
  const bodies = members.flatMap((t) => {
    const body = getBodyMediaType(types, t)
    return body ? [{ type: t, ...body }] : []
  })

  return {
    sent: dedupe(
      bodies.map((b): JsonSchema => ({ type: 'string', contentMediaType: b.mediaType })),
    ),
    others: members.filter((t) => !bodies.some((b) => b.type === t && !b.view)),
  }
}

const LITERAL_FLAGS = TypeFlags.StringLiteral | TypeFlags.NumberLiteral | TypeFlags.BooleanLiteral

/**
 * Converts TypeScript types into JSON Schemas (draft 2020-12), describing values as the server
 * sends them after oRPC's OpenAPI JSON serialization (e.g. `Date` as a `date-time` string), or,
 * with `direction: 'input'`, as a client sends them (classes as instances or plain objects).
 *
 * Named types are emitted as `$defs`. Conversions share a cache, so reuse one converter per program.
 *
 * @see {@link https://orpc.dev/docs/openapi/specification#converting-types-directly | OpenAPI Specification - Converting Types Directly}
 */
export class TypeToJsonSchemaConverter {
  private readonly defsMode: 'named' | 'recursive'
  /** Values a client sends: classes are instances or plain objects, `toJSON` is called of instances */
  private readonly input: boolean
  private readonly types: TypeQueries
  private readonly names: DefNames
  private readonly defs: DefRegistry
  private readonly expansion: ExpansionGuard
  /** Types whose `JSON.stringify` form differs from their serializer form */
  private readonly stringifySensitivity: ModeSensitivity
  /** Types whose `either` form differs from their serializer form */
  private readonly eitherSensitivity: ModeSensitivity

  private readonly cycles: AnonymousCycles
  /** Non-null cores of named nullable unions, back to the union (`Json` without `null` -> `Json`) */
  private readonly nullableCores = new Map<number, Type>()
  private voidType: Type | undefined
  /** Interfaces over views of typed arrays being converted as one of the values they may hold */
  private readonly typedArrayForms = new Map<number, 'typed' | 'plain'>()
  /** Def schemas with their unions written as discriminated ones, see `withDiscriminators` */
  private readonly discriminated = new WeakMap<object, JsonSchema>()

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
  /** Whether the value being converted is a parameter, see `TypeToJsonSchemaConvertOptions.parameters` */
  private parameters = false
  /** The object whose fields hold parameters, see `ParameterFields` */
  private parameterRoot: { type: Type; fields: ParameterFields } | undefined
  /** The fields holding parameters of the plain object visited at this depth, see `visitType` */
  private pendingFields: { depth: number; fields: ParameterFields } | undefined

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
    this.cycles = new AnonymousCycles(this.types)
    this.stringifySensitivity = new ModeSensitivity(this.types, 'stringify', this.input)
    this.eitherSensitivity = new ModeSensitivity(this.types, 'either', this.input)
  }

  /**
   * Converts a type, returning its schema, with the `$defs` it references, and whether it accepts `undefined`.
   */
  convert(
    type: Type | readonly Type[],
    options: TypeToJsonSchemaConvertOptions = {},
  ): [jsonSchema: JsonSchema, optional: boolean] {
    // a list of types is their union, like the yield types of a union of async iterators
    const members = (Array.isArray(type) ? type : [type]).flatMap((t) =>
      options.awaited === false ? [t] : this.getAwaitedTypes(t),
    )

    // a function (also with properties, `(() => number) & { tag: string }`) is written as nothing,
    // like `undefined`, also as a member of a union
    const unions = members.flatMap((t) => this.types.getUnionMembers(t))
    const serializable = unions.filter((t) => !isNonSerializable(this.types, t))
    const filtered = serializable.length < unions.length
    const optional =
      filtered ||
      // written as nothing, like a function whose `toJSON` is optional, or an instance whose
      // `toJSON` may return `undefined`
      members.some((t) => this.isOptional(t) || this.mayDropThroughToJSON(t, false))
    const { sent, others } = options.body
      ? splitBodies(this.types, serializable)
      : { sent: [], others: serializable }
    const { parameters = false } = options
    // a single value is visited whole, so a union keeps its def, unless a member is converted
    // with a body sent as is (`{ body: FormData } | { body: Json }` of a detailed one), or with
    // properties holding parameters
    const split =
      sent.length > 0 ||
      typeof parameters !== 'boolean' ||
      (options.bodyProperty === true && serializable.some((t) => this.holdsBodyProperty(t)))
    const values = split ? others : filtered ? serializable : members
    const visitRoot = (t: Type): JsonSchema => {
      // the root of a detailed input or output with a body sent as is
      const bodyProperty = options.bodyProperty === true && this.holdsBodyProperty(t)

      if (typeof parameters !== 'boolean' && parameters.only && this.isObjectType(t)) {
        return this.withParameterRoot(t, parameters, () => this.convertObject(t, { bodyProperty }))
      }

      // all fields but some, of a plain object (see `visitType`)
      if (typeof parameters !== 'boolean' && !bodyProperty) {
        return this.withPendingFields(0, parameters, () => this.visit(t))
      }

      if (bodyProperty) {
        return this.convertObject(t, { bodyProperty })
      }

      // the root is no parameter, the parameters are its fields
      return parameters === true && !isSentAsString(this.types, t)
        ? this.withParameters(() => this.visit(t))
        : this.visit(t)
    }

    const cuts = this.expansion.cuts
    this.expansion.reset()

    let schema: JsonSchema
    let $defs: Record<string, JsonSchema>

    try {
      const written =
        values.length === 1
          ? [visitRoot(values[0]!)]
          : others.length || !sent.length
            ? [this.convertMembers(others, visitRoot)]
            : []
      const all = [...sent, ...written]
      schema = all.length === 1 ? all[0]! : { anyOf: all }

      if (options.inlineRoot) {
        schema = this.defs.inlineRoot(
          schema,
          options.inlineProperties ?? [],
          options.partialProperties,
        )
      }

      $defs = this.defs.getReferencedDefs(schema)

      // on the final schemas, once inlined members are no longer refs
      const getDef = (name: string) => (Object.hasOwn($defs, name) ? $defs[name] : undefined)
      schema = withDiscriminators(schema, getDef)
      for (const [name, def] of Object.entries($defs)) {
        // a def's schema is final, and so are those of the defs it refers to
        let discriminated = this.discriminated.get(def as object)
        if (!discriminated) {
          discriminated = withDiscriminators(def, getDef)
          this.discriminated.set(def as object, discriminated)
        }
        setOwn($defs, name, discriminated)
      }
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

    // a `ReadableStream` is sent as binary data, not as an event stream
    if (!(type.flags & TypeFlags.Object) || getBodyMediaType(this.types, type)) {
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
    try {
      return this.visitType(type)
    } catch (error) {
      // where the compiler errors behind an unresolved type are
      if (error instanceof TypeScriptTypeResolutionError) {
        error.addDeclarations(type.getAliasSymbol())
        error.addDeclarations(type.getSymbol())
      }
      throw error
    }
  }

  private visitType(type: Type): JsonSchema {
    // `DeepReadonly<DeepReadonly<X>>` (a deep view of a class holding one) is `DeepReadonly<X>`,
    // which keeps a graph of deep views from nesting them without end
    const flattened = this.types.getFlattenedView(type)
    if (flattened.id !== type.id) {
      return this.visit(flattened)
    }

    // a plain object some fields of which hold parameters is written in place, as its def would
    // differ from that of the type, as would that of any other type holding it
    const pending = this.pendingFields
    if (pending?.depth === this.expansion.path.length) {
      // `X | undefined` is `X`
      const defined = type.isUnionType()
        ? this.types.getMembers(type).filter((m) => !(m.flags & UNDEFINED_FLAGS))
        : []
      if (defined.length === 1) {
        return this.visit(defined[0]!)
      }

      this.pendingFields = undefined
      try {
        return this.isPlainFieldsObject(type)
          ? this.withParameterRoot(type, pending.fields, () => this.convertObject(type))
          : this.visitType(type)
      } finally {
        this.pendingFields = pending
      }
    }

    // the bracket notation of a parameter sends it as `String(value)`
    if (this.parameters && isSentAsString(this.types, type)) {
      return { type: 'string' }
    }

    const key = this.key(type)
    const existing = this.defs.get(key)

    if (existing) {
      return { $ref: toRef(existing.name) }
    }

    // an unresolved name, also one the compiler reports nowhere (`// @ts-nocheck`, a declaration
    // file under `skipLibCheck`), which the error type of an instantiation the compiler gives up
    // on can not be told from
    if (type.isErrorType()) {
      const name = this.checker.typeToString(type)
      throw new TypeScriptTypeResolutionError(
        `Could not resolve the type "${name}". Check its import, and the tsconfig "paths" for aliases like "@/".${
          name === 'any'
            ? ' It may also be an unresolved name under a mapped type, or a type nested too deep for the compiler to instantiate.'
            : ''
        }`,
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
      this.defsMode === 'named' && !projectSymbol ? this.getProjectClassViewName(type) : undefined

    if (
      this.defsMode === 'named' &&
      (projectSymbol || viewName) &&
      !(type.flags & TypeFlags.Boolean)
    ) {
      return this.visitNamed(type, key, projectSymbol, viewName)
    }

    return this.visitAnonymous(type, key, projectSymbol)
  }

  /**
   * Converts a type written as a def: a named project type, or a view of a project class.
   */
  private visitNamed(
    type: Type,
    key: number,
    projectSymbol: TSSymbol | undefined,
    viewName: string | undefined,
  ): JsonSchema {
    // the name of a view yields to a declared type of that name, whichever comes first
    const preferredName = viewName ?? getDefName(this.types, type, projectSymbol!)
    const def = this.defs.create(key, preferredName)
    const cuts = this.expansion.cuts

    const schema = this.cycles.named(() => this.annotate(this.convertType(type), projectSymbol))

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
    const group = viewName ? String(getClassType(this.types, type)!.id) : preferredName

    return { $ref: toRef(this.defs.share(def, group).name) }
  }

  /**
   * Converts a type written in place, unless it comes back to itself: a cycle makes it a def.
   */
  private visitAnonymous(type: Type, key: number, projectSymbol: TSSymbol | undefined): JsonSchema {
    const enteredAt = this.cycles.enter(type, key)

    if (enteredAt === 'closed') {
      return { $ref: toRef(this.defs.create(key, getFallbackDefName(this.types, type)).name) }
    }

    const cuts = this.expansion.cuts

    let schema: JsonSchema
    try {
      schema = this.convertType(type)
    } finally {
      this.cycles.leave(key, enteredAt)
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

    // with `defs: 'recursive'`, a model or a view of a class referring to a def being converted
    // is in a cycle with it, so it refers to itself: a def too, which keeps a graph of models
    // from being written again at each use
    const cycleName =
      this.defsMode === 'recursive' && enteredAt === undefined
        ? (this.getProjectClassViewName(type) ??
          (this.cycles.hasCycleName(type) ? getFallbackDefName(this.types, type) : undefined))
        : undefined

    if (cycleName !== undefined && this.defs.refersToConverting(schema)) {
      const created = this.defs.create(key, cycleName)
      created.schema = schema
      created.stable = cuts === this.expansion.cuts
      return { $ref: toRef(created.name) }
    }

    // reuse it for siblings, `{ a: C<N>; b: C<N> }` would otherwise grow exponentially in time
    if (enteredAt === undefined && cuts === this.expansion.cuts) {
      this.defs.setAnonymous(key, schema)
    }

    return schema
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
      return this.convertNullableUnion(type)
    }

    if (type.isIntersectionType()) {
      return this.withBufferForm(type, this.convertIntersection(type))
    }

    if (flags & TypeFlags.Object) {
      return this.withBufferForm(type, this.convertObject(type))
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
   * Whether an object type has a `body` property holding a body sent as is (see `splitBodies`).
   */
  private holdsBodyProperty(type: Type): boolean {
    const property =
      type.flags & TypeFlags.Object || type.isIntersectionType()
        ? this.types.getProperty(type, 'body')
        : undefined
    const [propertyType] = property ? this.types.getSymbolTypes([property]) : []

    return (
      propertyType !== undefined &&
      this.types.getUnionMembers(propertyType).some((m) => getBodyMediaType(this.types, m))
    )
  }

  /**
   * A typed array (`Uint8Array`, `Readonly<Uint8Array>`), whose value may be a Node `Buffer`,
   * written by its own `toJSON` (`{ type: 'Buffer', data: [1] }`), not by fields a client sends
   * as parameters.
   */
  private withBufferForm(type: Type, schema: JsonSchema): JsonSchema {
    const node = getNodeBuffer(this.types)

    return node &&
      isTypedArray(this.types, type) &&
      this.checker.isTypeAssignableTo(node.buffer, type)
      ? anyOfDeduped([schema, ...node.written.map((written) => writtenForm(this.visit(written)))])
      : schema
  }

  /**
   * `undefined` members are left to the caller (optional), `null` adds a `null` branch.
   * The rest is visited as its own type, so a named union keeps its name (`Status | null`).
   */
  private convertNullableUnion(type: Type): JsonSchema {
    const members = this.types.getMembers(type)
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

  private convertIntersection(type: Type): JsonSchema {
    const members = this.types.getMembers(type)
    // branded primitives, e.g. `string & { __brand: 'UserId' }`
    const primitive = members.find((m) => m.flags & PRIMITIVE_FLAGS)
    if (primitive) {
      return this.visit(primitive)
    }

    // also through a view of one (`Readonly<UserId> & { extra?: string }`), which may also hold
    // a plain object (`Partial<UserId> & { extra?: string }`)
    const branded = members
      .map((m) => this.getMappedBrandedPrimitive(m))
      .find((m) => m !== undefined)
    if (branded) {
      return this.withPlainForm(type, this.visit(branded))
    }

    const arrayLike = members.find((m) => this.types.getReferenceKind(m) !== undefined)
    if (arrayLike) {
      // `JSON.stringify` calls `toJSON` of arrays, the serializer walks them
      return this.withAddedToJSON([type], () => this.visit(arrayLike))
    }

    // `Uint8Array & { label: string }` is written by its index keys and the added fields
    if (isTypedArray(this.types, type)) {
      return this.convertObject(type)
    }

    // branded built-ins, e.g. `Date & { __brand: 'CreatedAt' }`, whose `toJSON` an intersection
    // may add (`Date & { toJSON(): number }`), which `JSON.stringify` calls, the serializer does not
    // (also one the serializer leaves to `JSON.stringify`, `Error & { toJSON(): string }`, or
    // another member adds, `Set<string> & Pick<Date, 'toJSON'>`, not a view of the same built-in)
    for (const member of members) {
      const builtin =
        member.flags & TypeFlags.Object ? this.convertBuiltinObject(member) : undefined
      if (builtin !== undefined) {
        return this.withBuiltinToJSON(type, members, member, builtin)
      }
    }

    // `object & { extra?: string }` also holds arrays and dates, `{} & { extra?: string }` strings
    if (isLooseIntersection(this.types, type)) {
      return anyOfDeduped([{}, this.convertObject(type)])
    }

    return this.convertObject(type)
  }

  /**
   * A built-in of an intersection (`Date & { toJSON(): number }`), or of a view of one
   * (`Readonly<Error & { toJSON(): string }>`), with the `toJSON` its other `members` add.
   */
  private withBuiltinToJSON(
    type: Type,
    members: readonly Type[],
    builtinMember: Type,
    builtin: JsonSchema,
  ): JsonSchema {
    return this.withAddedToJSON(
      // also the own `toJSON` of an interface over a view of the built-in (`ROnum & { code: number }`
      // of `interface ROnum extends Readonly<Number> { toJSON(): string }`)
      members.filter((m) =>
        m === builtinMember
          ? addsOwnToJSON(this.types, m)
          : !hasToJSONOf(this.types, m, builtinMember),
      ),
      () => this.withPlainForm(type, builtin),
      getStringifiedForm(this.types, type.isIntersectionType() ? builtinMember : type),
    )
  }

  /**
   * An array or built-in of an intersection (`written`), or, under `JSON.stringify`, what the
   * `toJSON` of `owners` returns, which the serializer does not call (`Date & { toJSON(): number }`).
   * The serializer leaves an `instance` of some built-ins to `JSON.stringify` (`Error & { toJSON(): string }`),
   * and a `view` of one may hold an instance, or a plain object the serializer walks.
   */
  private withAddedToJSON(
    owners: readonly Type[],
    written: () => JsonSchema,
    stringified?: 'instance' | 'view',
  ): JsonSchema {
    const stringify = this.mode === 'stringify' || stringified === 'instance'
    const toJSONResults =
      this.mode !== 'serializer' || stringified
        ? owners.flatMap((owner) => getToJSONResultTypes(this.types, owner, true))
        : []

    if (!toJSONResults.length) {
      return written()
    }

    const converted = this.convertToJSONResults(toJSONResults)

    // a `toJSON` that may be missing (`toJSON?(): number`, `Partial<Stamp>`) leaves the written value
    if (stringify && !owners.some((owner) => hasOptionalToJSON(this.types, owner))) {
      return anyOfDeduped(converted)
    }

    // a `toJSON` returning only `undefined` writes nothing, the written value remains
    const kept = converted.filter((_, i) => !isDroppedResult(this.types, toJSONResults[i]!))
    return anyOfDeduped([...kept, written()])
  }

  private convertObject(type: Type, options: ObjectForm = {}): JsonSchema {
    if (isEffectValue(this.types, type)) {
      return {}
    }

    let { plain = false } = options
    const { ignoreToJSON = false, ownFields = false, bodyProperty = false } = options
    // a client sends a value of a class type (or of a view of one, `Readonly<User>`) as an instance,
    // written without its getters, or as the built-in the class extends
    // (`Pick<class Stamp extends Date, 'label'>`), or as a plain object, and so a value of an
    // interface extending a built-in class (`interface AppError extends Error`), as for outputs
    const sentClass =
      this.input && !plain && !ownFields
        ? (getClassType(this.types, type) ??
          (extendsBuiltinClass(this.types, type) ? type : undefined))
        : undefined
    // under `JSON.stringify` (inside an instance), and for a class with private members, which
    // no plain object satisfies, a client sends what an instance writes, as the server does
    const sentInstance =
      this.input &&
      (this.mode === 'stringify' || (sentClass !== undefined && this.types.isNominalClass(type)))
    const sentForms = sentClass !== undefined && !sentInstance

    // `Readonly<UserId>`, or `DeepReadonly<T>` over `UserId = string & { __brand: 'UserId' }`,
    // maps over the members of the primitive, the value is still the primitive, or also a plain
    // object of a view leaving members out or optional (`Omit<UserId, '__brand'>`, `Partial<UserId>`)
    const branded = plain ? undefined : this.getMappedBrandedPrimitive(type)
    if (branded) {
      return this.withPlainForm(type, this.visit(branded))
    }

    // a client sends a plain object, whose `toJSON` the serializer skips, or what an instance of a
    // class implementing the type writes (`interface Point { toJSON(): string }`), as for outputs
    if (this.input && !sentInstance) {
      plain = true
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
      // a view of an intersection with a built-in (`Readonly<Error & { toJSON(): string }>`), or an
      // interface extending a view of one with its own `toJSON` (`interface Msg extends Pick<Error,
      // 'message'> { toJSON(): string }`), which adds it like an intersection, unless its `toJSON`
      // returned it, which `JSON.stringify` does not call again
      const views = getViewBases(this.types, type)
      const sources = getViewSources(this.types, type)
      // the built-in itself, not an interface over a view of it (`Readonly<ROnum>` of `interface
      // ROnum extends Readonly<Number> { toJSON(): string }`), whose `toJSON` is added
      const viewed = ignoreToJSON
        ? undefined
        : (sources.find(
            (m) => hasBuiltinForm(this.types, m) && !getViewBases(this.types, m).length,
          ) ?? sources.find((m) => hasBuiltinForm(this.types, m)))
      return viewed
        ? this.withBuiltinToJSON(type, views.length ? [type, ...sources] : sources, viewed, builtin)
        : this.withPlainForm(type, builtin)
    }

    // the class behind `Readonly<C>`, `Pick<C, K>`, or `C & { extra }` (`Object.freeze`, `Object.assign`)
    const classType = plain ? undefined : getClassType(this.types, type)

    // a view of a class may hold an instance or a plain object, unless only instances
    // are assignable to it (an interface or intersection over a class with private members),
    // and so may an interface extending a built-in class (`interface AppError extends Error`)
    const isView = !plain && isInstanceOrPlain(this.types, type)

    // the serializer leaves an instance to `JSON.stringify` and walks a plain object,
    // so each value of a view is written by either one
    if (isView && this.mode === 'serializer') {
      return this.withMode('either', () => this.convertObject(type, options))
    }

    // in the either mode, a view is an instance or a plain object, field by field
    // (under `JSON.stringify`, a view is written as an instance)
    const eitherView = isView && this.mode === 'either'
    const instanceClass = classType ?? sentClass

    // a client's serializer leaves an instance to `JSON.stringify`, which calls its `toJSON` and
    // writes its `Set` fields as `{}`, so each value is either form, as in a view of an output
    // (the built-in a class extends is written as the built-in, see below, not by its `toJSON`). The
    // `toJSON` is the type's own (also one an intersection adds, `C & { toJSON(): string }`), or of
    // each class a view leaving it out or mapping it to no method (`LooseDeep<C>`) is over. A
    // `toJSON` returning only `undefined` writes nothing, the caller makes it optional.
    if (sentForms && !ignoreToJSON) {
      const classes = getClassTypes(this.types, type)
      const results = (getToJSONResultTypes(this.types, type, true).length ? [type] : classes)
        .filter(
          (source) =>
            !classes.some(
              (c) => hasBuiltinForm(this.types, c) && hasToJSONOf(this.types, source, c),
            ),
        )
        .flatMap((source) => getWrittenToJSONResultTypes(this.types, source))
      const fields = this.withMode('either', () =>
        this.convertObject(type, { ...options, ignoreToJSON: true }),
      )

      return results.length
        ? anyOfDeduped([
            ...this.convertToJSONResults(results),
            ...this.getPrimitiveWithoutToJSON(type, [type]),
            fields,
          ])
        : fields
    }

    if (instanceClass && !ownFields) {
      // of each class behind it (`interface L extends Pick<A, 'id'>, Pick<class B extends Date, 'v'>`)
      const classes = getClassTypes(this.types, type).filter((c) => c.id !== type.id)
      const subclasses = classes
        .map((c) => this.convertBuiltinObject(c))
        .filter((schema): schema is JsonSchema => schema !== undefined)
        .map(writtenForm)

      if (subclasses.length) {
        // an instance is written as the built-in, a plain object (or an instance of a class
        // extending none) by its fields
        return anyOfDeduped(
          isView || sentForms
            ? [...subclasses, this.convertObject(type, { ignoreToJSON, plain: true })]
            : subclasses.length < classes.length
              ? [...subclasses, this.convertObject(type, { ignoreToJSON, plain, ownFields: true })]
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
    // (also one a client sends, which the serializer leaves to `JSON.stringify`)
    const viewedFunction =
      ownToJSON.length || ignoreToJSON ? undefined : getViewedFunction(this.types, type)
    const viewedResults =
      viewedFunction && viewedFunction !== type
        ? getWrittenToJSONResultTypes(this.types, viewedFunction)
        : []

    if (viewedResults.length) {
      return anyOfDeduped([
        ...this.convertToJSONResults(viewedResults),
        this.convertObject(type, { ignoreToJSON: true, plain, ownFields }),
      ])
    }

    const jsonSources = ownToJSON.length || !classType ? [type] : getClassTypes(this.types, type)
    // of each source, empty when it has no `toJSON`
    const sourceResults = ignoreToJSON
      ? []
      : jsonSources.map((c) => getToJSONResultTypes(this.types, c, stringifyRules))
    const toJSONResults = sourceResults.flat()
    if (toJSONResults.length) {
      const converted = this.convertToJSONResults(toJSONResults)
      // a function, not a plain object of an interface extending `Function`, which has no call
      // signature (`interface JsonFn extends Function { toJSON(): string }`)
      const callable = isFunction(this.types, type) && this.types.isCallable(type)

      const mayLackToJSON =
        sourceResults.some((results) => !results.length) ||
        jsonSources.some((source) => hasOptionalToJSON(this.types, source)) ||
        // the serializer does not walk a function, `JSON.stringify` calls its `toJSON`
        (!callable &&
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
      if (callable) {
        return anyOfDeduped(
          converted.filter((_, i) => !isDroppedResult(this.types, toJSONResults[i]!)),
        )
      }

      // without `toJSON`, a value is its own fields, of an instance or (for a view or an interface)
      // of a plain object. A `toJSON` returning only `undefined` writes nothing, the fields remain.
      const fields = this.convertObject(type, { ignoreToJSON: true, plain, ownFields })
      return anyOfDeduped([
        ...converted.filter((_, i) => !isDroppedResult(this.types, toJSONResults[i]!)),
        ...this.getPrimitiveWithoutToJSON(type, jsonSources),
        fields,
      ])
    }

    /** Fields written by `JSON.stringify` */
    const isClassInstance = classType !== undefined && !eitherView
    // the class of an instance a value may be, besides a plain object: of a view, also one
    // a client sends, or an interface extending a built-in (`interface AppError extends Error`)
    const viewedClass = eitherView
      ? (classType ?? type)
      : sentForms
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

    // the empty object type `{}` (also `NonNullable<unknown>`, `Pick<User, never>`, or a class
    // without members) accepts any value but `null` and `undefined`, a type of methods only
    // (`Iterable<string>`, `interface Lookup { has(key: string): boolean }`) arrays, sets, or strings
    // too, and `Record<string, any>` any object. Not one extending a boxed primitive
    // (`class MyNum extends Number { toJSON(): string }`), whose value is the primitive, written
    // apart, or a plain object (but a `WeakMap` may hold a `Map`, written as an array).
    if (
      (properties.every((p) => p.flags & SymbolFlags.Method || p.escapedName.startsWith('__@')) &&
        !isObjectLiteral(type) &&
        !getIndexInfos(this.types, type).length &&
        !this.checker.getSignaturesOfType(type, SignatureKind.Construct).length &&
        ![type, ...getClassTypes(this.types, type)].some(
          (c) => getExtendedPrimitiveSchema(this.types, c) !== undefined,
        )) ||
      isAnyRecord(this.types, type)
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
          return this.convertObject(type, { ignoreToJSON, plain, ownFields })
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
        (!this.input || fieldsMode === 'stringify') && propertyType
          ? getToJSONResultTypes(this.types, propertyType, fieldsMode === 'stringify')
          : []
      if (
        !propertyType ||
        isDropped(this.types, propertyType) ||
        (serialized.length &&
          serialized.every((result) => isDroppedResult(this.types, result)) &&
          // unless the value may be written without calling `toJSON`: the method is optional,
          // or the serializer may walk it as a plain object (`interface Point { toJSON(): undefined }`)
          !hasOptionalToJSON(this.types, propertyType) &&
          (fieldsMode === 'stringify' || !mayBePlainObject(this.types, propertyType)))
      ) {
        continue
      }

      // `string | (() => void)`: JSON serialization drops the key when it holds a function
      const serializable = this.getSerializableMembers(propertyType)

      // a body sent as is, besides the other values it may hold
      const body =
        bodyProperty && property.name === 'body'
          ? splitBodies(
              this.types,
              (serializable ?? this.types.getUnionMembers(propertyType)).filter(
                (m) => !(m.flags & UNDEFINED_FLAGS),
              ),
            )
          : undefined

      const convertProperty = () =>
        body?.sent.length
          ? anyOfDeduped([
              ...body.sent,
              ...(body.others.length ? [this.convertMembers(body.others, convertValue)] : []),
            ])
          : serializable
            ? this.convertMembers(serializable, convertValue)
            : convertValue(this.getNullableAliasType(property, propertyType) ?? propertyType)

      let propertySchema: JsonSchema
      this.expansion.path.push(property)
      try {
        const selected = this.getParameterSelection(type, property.name)
        propertySchema =
          selected === true
            ? this.withParameters(convertProperty)
            : typeof selected === 'object'
              ? this.withPendingFields(this.expansion.path.length, selected, convertProperty)
              : convertProperty()
      } catch (error) {
        if (error instanceof TypeScriptTypeResolutionError) {
          error.addDeclarations(property)
        }
        throw error
      } finally {
        this.expansion.path.pop()
      }

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
        (!instanceProperties || instanceProperties.has(property)) &&
        // nor what a view copies from a built-in (`size` of `interface Tags extends Readonly<Set<string>>`)
        !(ownFields && !plain && isBuiltinMember(this.types, property))
      ) {
        required.push(property.name)
      }
    }

    if (required.length) {
      schema.required = required
    }

    this.convertIndexSignatures(type, schema, convertValue)

    // an instance holds no keys besides its fields and indexes, so these keep the value type in
    // OpenAPI 3.0
    if (typedArray) {
      delete schema.patternProperties
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

    // an array-like view may also hold a plain object, and an array, a string, a `Set`, a `Map`,
    // or a typed array may satisfy an object type by its members (`ArrayLike<number>`,
    // `{ size?: number }`): forms written in place of the fields, which an input split into
    // parameters is not read by
    const forms = arrayLike
      ? [arrayLike.schema]
      : classType || typedArray
        ? []
        : this.convertStructuralForms(type, properties)
    if (!forms.length) {
      return schema
    }

    // `JSON.stringify` writes a `Set` or a `Map` as `{}`, which also covers the fields
    const withForms = anyOfDeduped([...forms.map(writtenForm), schema])
    return typeof withForms === 'object' && withForms.anyOf?.some((s) => isPlain(s, 'object'))
      ? withAnyObject(withForms)
      : withForms
  }

  /**
   * The arrays, strings, and typed arrays an object type of their members (`length`, a number
   * index) holds, the sets and maps one of theirs (`size`), and the tuples one of indexes holds.
   */
  private convertStructuralForms(type: Type, properties: readonly TSSymbol[]): JsonSchema[] {
    // neither has a string index
    if (getIndexInfos(this.types, type).some((info) => !(info.keyType.flags & TypeFlags.Number))) {
      return []
    }

    const forms: JsonSchema[] = []
    const weak = properties.every((p) => p.flags & SymbolFlags.Optional)

    // only types of their members, checked by the compiler, `{ filter: string }` is no array,
    // `{ length: number; extra?: string }` is one without `extra`. Of a type of optional
    // properties only, which any value sharing one satisfies (`Partial<Date>` an array by its
    // `toString`), all are.
    const isTypeOfMembers = (name: 'Array' | 'String') => {
      const members = this.types.getGlobalType(name)
      return (
        members !== undefined &&
        properties.every(
          (p) =>
            (p.flags & SymbolFlags.Optional && !weak) || this.getPropertyNames(members).has(p.name),
        )
      )
    }

    const anyArray = isTypeOfMembers('Array') ? this.types.getPrototypeType('Array') : undefined
    if (anyArray && this.checker.isTypeAssignableTo(anyArray, type)) {
      forms.push({
        type: 'array',
        items: this.visitElement(getNumberIndexType(this.types, type)),
      })
    }

    if (
      isTypeOfMembers('String') &&
      this.checker.isTypeAssignableTo(this.checker.getStringType(), type)
    ) {
      forms.push({ type: 'string' })
    }

    for (const collection of [
      ...getSatisfyingCollections(this.types, type),
      ...getSatisfyingTypedArrays(this.types, type),
    ]) {
      forms.push(this.visit(collection))
    }

    // a tuple satisfies an object type of the indexes from 0 (`TupleToObject<[string, number]>`),
    // also besides members of arrays (`{ [K in keyof Pair & string]: Pair[K] }`)
    const indexes = properties.filter((p) => /^(?:0|[1-9]\d*)$/u.test(p.name))
    if (
      indexes.length &&
      indexes.every((p) => Number(p.name) < indexes.length) &&
      this.holdsArrayMembers(properties.filter((p) => !indexes.includes(p)))
    ) {
      const elementTypes = this.types.getSymbolTypes(indexes)
      const prefixItems: JsonSchema[] = []
      let minItems = 0

      indexes.forEach((property, i) => {
        const index = Number(property.name)
        prefixItems[index] = this.visitElement(elementTypes[i])
        if (!(property.flags & SymbolFlags.Optional)) {
          minItems = Math.max(minItems, index + 1)
        }
      })

      const rest = getNumberIndexType(this.types, type)
      forms.push({
        type: 'array',
        prefixItems,
        ...(minItems ? { minItems } : {}),
        ...(rest ? { items: this.visitElement(rest) } : {}),
      })
    }

    return forms
  }

  /**
   * Whether an array has the properties of an object type by its members: `length` of a number,
   * others methods JSON drops (`length: 3` and `push` of `{ [K in keyof Pair & string]: Pair[K] }`).
   */
  private holdsArrayMembers(properties: readonly TSSymbol[]): boolean {
    if (!properties.length) {
      return true
    }

    const array = this.types.getGlobalType('Array')
    const names = array && this.getPropertyNames(array)
    const types = this.types.getSymbolTypes(properties)
    return properties.every((p, i) => {
      const type = types[i]
      return (
        names?.has(p.name) === true &&
        type !== undefined &&
        (p.name === 'length'
          ? this.types
              .getUnionMembers(type)
              .every((m) => m.flags & (TypeFlags.NumberLike | UNDEFINED_FLAGS))
          : isDropped(this.types, type))
      )
    })
  }

  private getPropertyNames(type: Type): ReadonlySet<string> {
    return this.types.memo(
      'propertyNames',
      type.id,
      () => new Set(this.types.getProperties(type).map((p) => p.name)),
    )
  }

  /**
   * A string index covers every key, narrower number and template literal keys add nothing.
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

    const keys = getIndexInfos(this.types, type).map((info) => ({
      info,
      key: getIndexKeyType(this.types, info.keyType),
    }))
    const anyKey = keys.find(({ key }) => key && key.flags & TypeFlags.String)
    const patternKeys = keys.filter(
      ({ key }) =>
        key && key.flags & (TypeFlags.Number | TypeFlags.TemplateLiteral | TypeFlags.StringMapping),
    )

    if (anyKey) {
      schema.additionalProperties = convertEntry(anyKey.info.valueType)
      return
    }

    // a number or template literal index checks only the keys it matches, which an object literal
    // type (`{ mode: string }`) may hold others besides
    for (const { info, key } of patternKeys) {
      schema.patternProperties ??= {}
      setOwn(
        schema.patternProperties,
        key!.flags & TypeFlags.Number ? NUMBER_KEY_PATTERN : `^${toPattern(this.types, key!)}$`,
        convertEntry(info.valueType),
      )
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
        return setSchema(
          this.visitElements(builtin.items),
          builtin.items.every((item) => isPrimitive(this.types, item)),
        )
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
        builtin ?? this.withMode(modes[i]!, () => this.convertObject(type, { ownFields: true })),
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
   * (`Pick<[number, string], 0>`, `Omit<string[], 'length'>`).
   */
  private convertArrayLikeObject(
    type: Type,
    properties: readonly TSSymbol[],
  ): { schema: JsonSchema; only: boolean } | undefined {
    const slice = properties.find((p) => p.name === 'slice')
    // the `slice` of an array, not of a string (`Partial<class Tag extends String>`)
    const keptSlice = slice !== undefined && this.isArrayMember(slice)
    const keptLength = properties.find((p) => p.name === 'length')
    // a view leaving `length` out (`Omit<string[], 'length'>`) has it by the array it is over
    const source = keptSlice && keptLength ? undefined : this.types.getMappedSource(type)
    const viewed = source && this.types.getReferenceKind(source) !== undefined ? source : undefined
    const length = keptLength ?? (viewed && this.types.getProperty(viewed, 'length'))

    if (!length || (!keptSlice && !viewed)) {
      return undefined
    }

    const numeric = properties.filter((p) => /^\d+$/u.test(p.name))
    // in index order, `0`, `1`, ...
    const elements = numeric.map((_, i) => numeric.find((p) => p.name === String(i)))
    const ordered = elements.every((e) => e !== undefined) ? (elements as TSSymbol[]) : numeric
    const [lengthType, ...elementTypes] = this.types.getSymbolTypes([length, ...ordered])
    // `Partial` makes the length optional, a tuple with optional elements has several
    // (`1 | 2` of `Readonly<[number, string?] & { extra?: string }>`)
    const members = lengthType ? this.types.getUnionMembers(lengthType) : []
    const lengths = members.filter((t) => t.flags & TypeFlags.NumberLike)

    // a mapped type changing the values (`{ [K in keyof T]?: true }`) is no array
    if (!lengths.length) {
      return undefined
    }

    const only =
      keptSlice &&
      keptLength !== undefined &&
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
        const own = global && this.types.getProperty(global, property.name)?.declarations
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
      results.map((result) => writtenForm(this.convertToJSONResult(result))),
    )
  }

  /**
   * `JSON.stringify` calls `toJSON` once: the returned value is serialized by its own fields,
   * so a returned `Date` is `{}`, and `this` (or `{ ...this }`) are the instance's fields.
   * Its properties and items go through `toJSON` again, so they are converted as usual.
   * `plainForm` also documents the plain object a view of a built-in may hold.
   */
  private convertToJSONResult(type: Type, plainForm = true): JsonSchema {
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
          .filter((m) => !(m.flags & NULLISH_FLAGS) && !isDroppedResult(this.types, m))
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
    // (`class MyDate extends Date`, also `Readonly<MyDate>`, `MyDate & { x }`, or an interface
    // extending one, `interface Stamp extends Date`) by its own fields
    const typedArray = isTypedArray(this.types, resolved)
    const classType =
      getClassType(this.types, resolved) ??
      ((resolved.getSymbol()?.flags ?? 0) & SymbolFlags.Interface ? resolved : undefined)

    // a subclass of a boxed primitive (`class Tag extends String`) is written as its primitive
    const boxed = classType && getExtendedPrimitiveSchema(this.types, classType)
    if (boxed) {
      return boxed
    }

    if (
      typedArray ||
      (classType &&
        (getBuiltinBaseName(this.types, classType) !== undefined ||
          // also through a view of the built-in (`interface Zoned extends Readonly<Date>`)
          extendsBuiltinView(this.types, classType)))
    ) {
      return this.convertObject(resolved, { ignoreToJSON: true, ownFields: !typedArray })
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
        // the plain object of the whole intersection holds the fields it adds
        return this.withPlainResult(resolved, this.convertToJSONResult(base, false))
      }
    }

    // a returned built-in is written by its own fields, also through `Readonly<Date>`
    const fields = this.convertBuiltinFields(resolved)
    return fields === undefined
      ? this.convertObject(resolved, { ignoreToJSON: true })
      : plainForm
        ? this.withPlainResult(resolved, fields)
        : fields
  }

  /**
   * What `toJSON` returned as a built-in, or also the plain object a view of it may hold, written
   * by its own fields (`{ valueOf: () => 1, x: 'x' }` of `Pick<Number, 'valueOf'> & { x: string }`).
   */
  private withPlainResult(type: Type, builtin: JsonSchema): JsonSchema {
    return this.mayHoldPlainObject(type)
      ? anyOfDeduped([
          builtin,
          this.convertObject(type, { ignoreToJSON: true, plain: true, ownFields: true }),
        ])
      : builtin
  }

  /**
   * What `JSON.stringify` writes of a returned built-in by its own fields. A library interface
   * describing other values (`ArrayLike<string>`) is written by its members, or as any object of
   * an instance of a runtime class implementing it, whose getters are not written (`Body` of a `Response`).
   */
  private convertBuiltinFields(type: Type): JsonSchema | undefined {
    const fields = getBuiltinFields(this.types, type)

    return fields === 'members'
      ? withAnyObject(this.convertObject(type, { ignoreToJSON: true }))
      : fields
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
    const fields = this.convertObject(type, {
      ignoreToJSON: true,
      plain: !classView,
      ownFields: true,
    })

    // `JSON.stringify` writes a `Set` as `{}`, which also covers its plain object
    return isPlain(builtin, 'object') && typeof fields === 'object' && fields.type === 'object'
      ? builtin
      : anyOfDeduped([writtenForm(builtin), fields])
  }

  /**
   * Whether a mapped view of a built-in or class may hold a plain object: it makes members
   * optional (`Partial<Date>`) or leaves some out (`Pick<URL, 'href'>`), also in an intersection,
   * and any view of a primitive or of its interface, or an interface extending one, whose few
   * members a plain object easily has (`{ valueOf: () => true }` of `Omit<boolean, 'k'>` or
   * `Pick<Boolean, 'valueOf'>`).
   */
  private mayHoldPlainObject(type: Type): boolean {
    if (type.isIntersectionType()) {
      return this.types.getMembers(type).some((m) => this.mayHoldPlainObject(m))
    }

    // so may an interface extending the interface of a primitive (`interface Num extends Number {}`)
    const symbol = type.getSymbol()
    if (
      symbol !== undefined &&
      symbol.flags & SymbolFlags.Interface &&
      !(symbol.flags & SymbolFlags.Class) &&
      getExtendedPrimitiveSchema(this.types, type) !== undefined
    ) {
      return true
    }

    // an interface extending a view of a built-in (`interface Link extends Pick<URL, 'href'>`)
    const views = getViewBases(this.types, type)
    if (views.length) {
      return views.some((view) => this.mayHoldPlainObject(view))
    }

    // the members of an intersection a conditional mapped type maps over, which it has no trace of,
    // or the branded primitive its brand is declared by
    const source = this.types.getMappedSource(type)
    const members = source ? [source] : this.types.getMappedSourceMembers(type)
    const sources = members.length ? members : this.types.getBrandedOwners(type)

    if (!sources.length) {
      return false
    }

    const sourceProperties = new Map(
      sources.flatMap((s) => this.types.getProperties(s)).map((p) => [p.name, p]),
    )
    const properties = this.types.getProperties(type)

    return (
      this.types.isPrimitiveView(type) ||
      // also of its interface (`Pick<Boolean, 'valueOf'>`, `Readonly<Number>`), not of a brand
      // narrowing its members (`number & { valueOf(): 1 }`)
      (source !== undefined &&
        isBoxedPrimitive(this.types, source) &&
        !this.types.getBrandedOwners(type).length) ||
      // the source may hold one (`Readonly<Link>` of `interface Link extends Pick<URL, 'href'>`),
      // also a view in an intersection (`Readonly<Pick<Date, 'getTime'> & { x: string }>`)
      sources.some((s) =>
        [
          ...getViewBases(this.types, s),
          ...(s.isIntersectionType()
            ? this.types.getMembers(s).filter((m) => (m as any).objectFlags & ObjectFlags.Mapped)
            : []),
        ].some((view) => this.mayHoldPlainObject(view)),
      ) ||
      properties.length < sourceProperties.size ||
      properties.some(
        (p) =>
          p.flags & SymbolFlags.Optional &&
          !((sourceProperties.get(p.name)?.flags ?? 0) & SymbolFlags.Optional),
      )
    )
  }

  /**
   * The branded primitive (`string & { __brand: 'UserId' }`) a mapped type is a view of, keeping
   * the values of the keys it keeps (`Readonly<T>`, `DeepReadonly<T>`, `Omit<T, '__brand'>`), which
   * may hold the primitive. One changing them (`{ [K in keyof T]?: true }`) is an object.
   * A view keeping only members of the primitive's interface holds any value of the primitive,
   * not only the literal or template of the brand (`Omit<'lit' & { __brand: 'Lit' }, '__brand'>`).
   */
  private getMappedBrandedPrimitive(type: Type): Type | undefined {
    const branded = this.findMappedBrandedPrimitive(type)
    const primitive =
      branded && this.types.getMembers(branded).find((m) => m.flags & PRIMITIVE_FLAGS)

    if (!primitive || !(primitive.flags & (LITERAL_FLAGS | TypeFlags.TemplateLiteral))) {
      return branded
    }

    // by the names of all members, a symbol key (`[Symbol.iterator]`) is not found by its name
    const apparent = this.checker.getApparentType(primitive)
    const members = apparent && this.getPropertyNames(apparent)
    return members && this.types.getProperties(type).every((p) => members.has(p.name))
      ? (this.checker.getBaseTypeOfLiteralType(primitive) ?? branded)
      : branded
  }

  private findMappedBrandedPrimitive(type: Type): Type | undefined {
    if (!((type as any).objectFlags & ObjectFlags.Mapped)) {
      return undefined
    }

    const keys = new Set(this.types.getProperties(type).map((p) => p.name))
    // a mapped type without keys keeps no member (`Record<UserId, User>` maps over its keys)
    if (!keys.size) {
      return undefined
    }

    const source = this.types.getMappedSource(type)
    const isViewed = (candidate: Type) => {
      if (
        !candidate.isIntersectionType() ||
        !this.types.getMembers(candidate).some((m) => m.flags & PRIMITIVE_FLAGS)
      ) {
        return false
      }

      const candidateKeys = new Set(this.types.getProperties(candidate).map((p) => p.name))
      return (
        [...keys].every((key) => candidateKeys.has(key)) &&
        this.types.isMappedViewOf(type, candidate)
      )
    }

    // a conditional mapped type keeps no trace of the branded primitive but its brand
    return (
      [...(source ? [source] : []), ...this.types.getTypeArguments(type)].find(isViewed) ??
      this.types.getBrandedOwners(type).find(isViewed)
    )
  }

  /**
   * Whether a plain object of an interface over a view of a typed array has fields its index keys
   * do not cover: of the view, ones JSON writes as something else than a number (`buffer`).
   */
  private mayHoldPlainFields(type: Type): boolean {
    return getTypedArrayViewBases(this.types, type).some((view) =>
      this.types
        .getPropertyTypes(view)
        .some(
          (t) =>
            t !== undefined &&
            !isDropped(this.types, t) &&
            this.types
              .getUnionMembers(t)
              .some((m) => !(m.flags & (TypeFlags.NumberLike | UNDEFINED_FLAGS))),
        ),
    )
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
   * The primitive a value of a type extending a boxed primitive is written as when the `toJSON` of
   * one of `sources` may be missing (`interface N extends Number { toJSON?(): string }`,
   * `Partial<INum>`): a primitive or a boxed one, besides a plain object of its fields.
   */
  private getPrimitiveWithoutToJSON(type: Type, sources: readonly Type[]): JsonSchema[] {
    const primitive = sources.some((source) => hasOptionalToJSON(this.types, source))
      ? getExtendedPrimitiveSchema(this.types, type)
      : undefined
    return primitive ? [primitive] : []
  }

  /**
   * Whether `toJSON` of a value of this type, or of a union member, may return what JSON
   * leaves out: `undefined`, a function, or a symbol. The key is then dropped, and an item `null`.
   * Inputs follow outputs: an instance of a class implementing an interface sends what its
   * `toJSON` returns (`interface Point { toJSON(): undefined }`).
   */
  private mayDropThroughToJSON(type: Type, stringify: boolean): boolean {
    return this.types.getUnionMembers(type).some((member) => {
      // a function without its optional `toJSON` is dropped, also by a client sending it
      if (mayBeNonSerializable(this.types, member)) {
        return true
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
          this.types.getUnionMembers(serialized).some((m) => isDroppedResult(this.types, m)),
      )
    })
  }

  /**
   * The def name of an anonymous view of a project class, like `Readonly<User>` or `User & { x }`.
   */
  private getProjectClassViewName(type: Type): string | undefined {
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
    const key = this.getModeKey(type)
    return this.parameters ? toParameterKey(key) : key
  }

  private getModeKey(type: Type): number {
    if (this.mode === 'serializer') {
      return type.id
    }

    // a type converted the same way as under the serializer shares its result, and so its def
    const sensitivity =
      this.mode === 'stringify' ? this.stringifySensitivity : this.eitherSensitivity
    return sensitivity.isSensitive(type) ? toModeKey(type.id, this.mode) : type.id
  }

  /**
   * Converts a parameter, see `TypeToJsonSchemaConvertOptions.parameters`.
   */
  private withParameters<T>(fn: () => T): T {
    const previous = this.parameters
    this.parameters = true
    try {
      return fn()
    } finally {
      this.parameters = previous
    }
  }

  /**
   * Converts a root whose properties of these names hold parameters, like `query` of a detailed
   * input, and the others not, like its `body`.
   */
  private withParameterRoot<T>(type: Type, fields: ParameterFields, fn: () => T): T {
    const previous = this.parameterRoot
    this.parameterRoot = { type, fields }
    try {
      return fn()
    } finally {
      this.parameterRoot = previous
    }
  }

  /**
   * Converts a value whose plain object, at this depth, has fields holding parameters.
   */
  private withPendingFields<T>(depth: number, fields: ParameterFields, fn: () => T): T {
    const previous = this.pendingFields
    this.pendingFields = { depth, fields }
    try {
      return fn()
    } finally {
      this.pendingFields = previous
    }
  }

  /**
   * Whether a field of an object holds parameters (`true`), some of its own fields do, or none
   * (`undefined`), see `ParameterFields`.
   */
  private getParameterSelection(type: Type, name: string): true | ParameterFields | undefined {
    const root = this.parameterRoot

    if (root?.type.id !== type.id) {
      return undefined
    }

    if (root.fields.only) {
      return Object.hasOwn(root.fields.only, name) ? root.fields.only[name] : undefined
    }

    return root.fields.except?.includes(name) ? undefined : true
  }

  /**
   * Whether a type is a plain object of the project or an anonymous one, written by its fields,
   * not an array, a built-in, a class or a view of one, which may be sent otherwise.
   */
  private isPlainFieldsObject(type: Type): boolean {
    if (!(type.flags & TypeFlags.Object) || this.types.getReferenceKind(type) !== undefined) {
      return false
    }

    const symbol = getNamedSymbol(type)

    return (
      (symbol === undefined || this.types.getSymbolSourceKind(symbol) === 'project') &&
      !((type.getSymbol()?.flags ?? 0) & SymbolFlags.Class) &&
      getClassType(this.types, type) === undefined &&
      !extendsBuiltinClass(this.types, type) &&
      !isTypedArray(this.types, type) &&
      !isSentAsString(this.types, type) &&
      !getViewBases(this.types, type).length &&
      getViewParts(this.types, type) === undefined
    )
  }

  /**
   * Whether a root is converted as an object, by its properties, not a branded primitive.
   */
  private isObjectType(type: Type): boolean {
    return type.isIntersectionType()
      ? !this.types.getMembers(type).some((m) => m.flags & PRIMITIVE_FLAGS)
      : Boolean(type.flags & TypeFlags.Object)
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

    // `status?: Status | 'archived'`, or a mapped type changing the value, is another type
    return this.hasSameMembers(annotated, type, UNDEFINED_FLAGS) ? annotated : undefined
  }

  /**
   * The project type alias a property's type annotation names (`count?: Count | null`),
   * when the property still has that type, but for `null` and `undefined`: a mapped type like
   * `{ [K in keyof T]: boolean }` keeps the source declaration but not its type.
   */
  private getAnnotationAlias(property: TSSymbol, type: Type): TSSymbol | undefined {
    const annotation = this.types.getAnnotation(property)

    if (!annotation) {
      return undefined
    }

    // `Count | null`, not `Count | string`, whose other members the alias does not describe
    return this.hasSameMembers(annotation.type, type, NULLISH_FLAGS) ? annotation.alias : undefined
  }

  /**
   * Whether two types have the same union members, but for those of the `ignored` flags.
   */
  private hasSameMembers(a: Type, b: Type, ignored: number): boolean {
    const ids = (t: Type) =>
      this.types
        .getUnionMembers(t)
        .filter((m) => !(m.flags & ignored))
        .map((m) => m.id)
    const members = new Set(ids(a))
    const others = ids(b)
    return others.length === members.size && others.every((id) => members.has(id))
  }
}

/**
 * Whether the values of a type are primitives, also branded ones (`string & { __brand: 'Id' }`),
 * not objects, which distinct values of may be written the same.
 */
function isPrimitive(types: TypeQueries, type: Type): boolean {
  return types
    .getUnionMembers(type)
    .every(
      (m) =>
        m.flags & PRIMITIVE_FLAGS ||
        (m.isIntersectionType() && types.getMembers(m).some((p) => p.flags & PRIMITIVE_FLAGS)),
    )
}

/**
 * A schema also accepting any object, which subsumes its object branches.
 */
function withAnyObject(schema: JsonSchema): JsonSchema {
  const branches =
    typeof schema === 'object' && schema.anyOf && Object.keys(schema).length === 1
      ? schema.anyOf
      : [schema]

  if (branches.some((b) => b === true || (typeof b === 'object' && Object.keys(b).length === 0))) {
    return {}
  }

  return anyOfDeduped([
    ...branches.filter((b) => !(typeof b === 'object' && b.type === 'object')),
    { type: 'object' },
  ])
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
 * Keys a number index checks: of the numbers `String(n)` writes (`'1'`, not `'01'`), here only
 * integers of up to 15 digits, which it writes in full.
 */
const NUMBER_KEY_PATTERN = '^(?:0|-?[1-9]\\d{0,14})$'

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

/**
 * The anonymous types being converted, to find cycles that come back to one without a named def
 * in between to stop at. Through a named def (`Tree[]` in `Tree`), converting it again ends there.
 */
class AnonymousCycles {
  /** Anonymous types being converted, with the named depth they were entered at */
  private readonly visiting = new Map<number, number>()
  private readonly stack: { type: Type; key: number }[] = []
  /** Types that close a cycle, preferred over wrappers around them for the def */
  private readonly closers = new Set<number>()
  private namedDepth = 0

  constructor(private readonly types: TypeQueries) {}

  /**
   * Converts a named def, which a cycle through it ends at.
   */
  named<T>(convert: () => T): T {
    this.namedDepth++
    try {
      return convert()
    } finally {
      this.namedDepth--
    }
  }

  /**
   * Enters an anonymous type, returning the named depth it was entered at before (pass it to
   * `leave`), or `closed` when it closes a cycle here and becomes a def.
   */
  enter(type: Type, key: number): number | 'closed' | undefined {
    const enteredAt = this.visiting.get(key)

    if (enteredAt === this.namedDepth) {
      const closer = this.getCycleCloser(type, key)

      if (closer === undefined) {
        return 'closed'
      }

      // convert this wrapper (`TreeNode[]`) once more, so the cycle closes at `TreeNode` instead
      this.closers.add(closer.key)
    }

    this.visiting.set(key, this.namedDepth)
    this.stack.push({ type, key })
    return enteredAt
  }

  leave(key: number, enteredAt: number | undefined): void {
    this.stack.pop()
    if (enteredAt === undefined) {
      this.visiting.delete(key)
    } else {
      this.visiting.set(key, enteredAt)
    }
  }

  /**
   * When a cycle comes back to a type without a good name, like `TreeNode[]` or
   * `Record<string, Dict>`, returns the named type in the cycle (`TreeNode`) to make the def for.
   */
  private getCycleCloser(type: Type, key: number): { type: Type; key: number } | undefined {
    if (this.closers.has(key) || this.hasCycleName(type)) {
      return undefined
    }

    const start = this.stack.findIndex((entry) => entry.key === key)

    // converted once more already, the closer did not come back
    if (this.stack.filter((entry) => entry.key === key).length > 1) {
      return undefined
    }

    return this.stack.slice(start + 1).find((entry) => this.hasCycleName(entry.type))
  }

  hasCycleName(type: Type): boolean {
    const symbol = getNamedSymbol(type)

    return Boolean(
      symbol &&
      !symbol.name.startsWith('__') &&
      this.types.getSymbolSourceKind(symbol) !== 'default',
    )
  }
}
