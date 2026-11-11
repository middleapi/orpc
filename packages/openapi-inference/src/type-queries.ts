import { SyntaxKind } from 'typescript/unstable/ast'
import type {
  Checker,
  NodeHandle,
  Program,
  Symbol as TSSymbol,
  Type,
  TypeReference,
} from 'typescript/unstable/sync'
import { ObjectFlags, SignatureKind, SymbolFlags, TypeFlags } from 'typescript/unstable/sync'

import { argumentsGrow, getDeclarationId, MAX_GROWTH, MAX_NESTING } from './expansion'
import type { JSDoc, SourceKind } from './utils'
import { createSourceKindChecker, getJSDoc, isTypeReference, resolveAlias } from './utils'

export const UNDEFINED_FLAGS = TypeFlags.Undefined | TypeFlags.Void

export const NULLISH_FLAGS = UNDEFINED_FLAGS | TypeFlags.Null

export const PRIMITIVE_FLAGS =
  TypeFlags.StringLike |
  TypeFlags.NumberLike |
  TypeFlags.BigIntLike |
  TypeFlags.BooleanLike |
  TypeFlags.ESSymbolLike

export const INSTANTIABLE_FLAGS =
  TypeFlags.TypeParameter |
  TypeFlags.IndexedAccess |
  TypeFlags.Conditional |
  TypeFlags.Substitution |
  TypeFlags.Index

/** The interfaces of the members of primitives */
const PRIMITIVE_INTERFACES = new Set(['String', 'Number', 'Boolean', 'BigInt', 'Symbol'])

const NAMEABLE_SYMBOL_FLAGS =
  SymbolFlags.Interface | SymbolFlags.Class | SymbolFlags.Enum | SymbolFlags.TypeAlias

/**
 * The kinds of the types an alias is declared with that the compiler may not keep it for, like a
 * reference to another type (`InferSelectModel<typeof users>`), unlike a type literal.
 */
const LOSING_ALIAS_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.TypeReference,
  SyntaxKind.TypeQuery,
  SyntaxKind.IndexedAccessType,
  SyntaxKind.ConditionalType,
  SyntaxKind.ImportType,
])

/**
 * The project type alias a property's type annotation names, with the type it has there.
 */
export interface PropertyAnnotation {
  alias: TSSymbol
  type: Type
  /** The type arguments the annotation writes (`Filter` and `Where` of `XOR<Filter, Where>`) */
  typeArguments: readonly Type[]
}

/**
 * A mapped type declaration keeping every value: `T[K]` of `Readonly<T>`, or with `deep`, the
 * alias over it (`DeepReadonly<T[K]>`).
 */
interface ValueMapping {
  alias: number
  deep: boolean
}

interface KeepingFrame {
  key: string
  source: Type
  /** The declarations of the source and the value, which an expansion instantiates again */
  declaration: number | undefined
  valueDeclaration: number | undefined
  /** How often in a row the source grew, `undefined` when it keeps expanding */
  growth: number | undefined
  /** Where the growth began */
  root: number
  /** Where it is on `keeping` */
  depth: number
  /** Once found kept assuming an enclosing pair, the frame of the outermost one */
  assumes?: KeepingFrame
}

/** A pair found kept assuming the pair of a frame is kept */
interface ProvisionalPair {
  key: string
  frame: KeepingFrame
}

/**
 * Compiler requests the conversion repeats for the same types and symbols, cached by their id.
 */
export class TypeQueries {
  readonly getSourceKind: (path: string) => SourceKind

  private readonly memos = new Map<string, Map<number | string, unknown>>()
  private readonly symbolTypes = new Map<number, Type | undefined>()

  /** Pairs of a value and its source found kept or not (see `keepsValue`) */
  private readonly keptValues = new Map<string, boolean>()
  /** Pairs being checked, innermost last */
  private readonly keeping: KeepingFrame[] = []
  /** Pairs found kept assuming an enclosing pair is kept, innermost last */
  private readonly provisionallyKept: ProvisionalPair[] = []
  /** The same pairs by their key, reused while the pair they assume is being checked */
  private readonly provisionalPairs = new Map<string, ProvisionalPair>()
  /** The outermost pair assumed kept in the check of the current pair */
  private assumedDepth = Number.POSITIVE_INFINITY

  /**
   * The project aliases of the types the compiler does not keep them for (see `getLostAlias`), and
   * the types `getLostAlias` was asked about, by the symbols of the types (see `getShape`)
   */
  private readonly lostAliases = new Map<number, Map<number, [Type, TSSymbol]>>()
  private readonly askedTypes = new Map<number, Map<number, Type>>()
  /** Whether an alias read named a type `getLostAlias` had been asked about, see `takeLateAliases` */
  private lateAliases = false
  /** The files `readAliases` read */
  private readonly aliasFiles = new Set<string>()
  /** The aliases `readAliases` found in them */
  private readonly aliasSymbols = new Set<number>()

  constructor(
    readonly checker: Checker,
    program: Program,
  ) {
    this.getSourceKind = createSourceKindChecker(program)
  }

  getSymbolSourceKind(symbol: TSSymbol): SourceKind {
    const path = symbol.declarations[0]?.path
    return path === undefined ? 'project' : this.getSourceKind(path)
  }

  /**
   * Caches a result by the id of a type or symbol (or a name), under a kind of question.
   */
  memo<T>(kind: string, id: number | string, compute: () => T): T {
    let cache = this.memos.get(kind)

    if (cache === undefined) {
      cache = new Map()
      this.memos.set(kind, cache)
    }

    if (!cache.has(id)) {
      cache.set(id, compute())
    }

    return cache.get(id) as T
  }

  /**
   * The type a mapped type maps over by its own keys, like `T` of `Readonly<T>`, `Partial<T>`,
   * or `Pick<T, K>`, not the argument of `{ [K in 'data']: T }`, whose values are not `T`.
   * Also through several of them, `Date` of `Partial<Readonly<Date>>`.
   */
  getMappedSource(type: Type): Type | undefined {
    return this.memo('mappedSource', type.id, () => {
      const source = this.getDirectMappedSource(type)
      return source && (this.getMappedSource(source) ?? source)
    })
  }

  private getDirectMappedSource(type: Type): Type | undefined {
    if (!((type as any).objectFlags & ObjectFlags.Mapped)) {
      return undefined
    }

    // `Readonly<C>` by its argument, an alias of one (`type View = Omit<C, 'x'>`, also
    // `type PickBox<K> = Pick<Box, K>`) by the type it is declared with
    const [argument] = this.getTypeArguments(type)
    if (argument && this.isMappedViewOf(type, argument)) {
      return argument
    }

    const primitive = this.getPrimitiveViewSource(type)
    if (primitive) {
      return primitive
    }

    // the declared type is not instantiated with the alias's arguments
    // (`Box<T>` of `type PickBox<T> = Pick<Box<T>, 'a'>`), so its type parameters match any type.
    // A conditional type resolving to a mapped type (`T extends object ? { [K in keyof T]: ... } : T`)
    // has no alias, its properties are still declared by the source.
    const declaring = this.getDeclaringType(type)
    return declaring && this.isMappedSourceOf(type, declaring, true) ? declaring : undefined
  }

  /**
   * Whether a mapped type is a view of a primitive by the interface of its members
   * (`Omit<boolean, 'k'>`, `Pick<string, number>`), also through views of one
   * (`Readonly<Omit<boolean, 'k'>>`), not of a branded primitive.
   */
  isPrimitiveView(type: Type): boolean {
    if (!((type as any).objectFlags & ObjectFlags.Mapped)) {
      return false
    }

    return this.memo('primitiveView', type.id, (): boolean => {
      if (this.getPrimitiveViewSource(type)) {
        return true
      }

      const source = this.getDirectMappedSource(type)
      return source !== undefined && this.isPrimitiveView(source)
    })
  }

  /**
   * The interface of the members of the primitive a mapped type is a view of (`Boolean` of
   * `Omit<boolean, 'k'>`, also of `type PlainBoolean = Omit<boolean, 'k'>`), when it keeps its
   * values, also of its index keys (`Pick<string, number>`).
   */
  private getPrimitiveViewSource(type: Type): Type | undefined {
    const [argument] = this.getTypeArguments(type)
    const primitive = argument ?? this.getDeclaringType(type)
    const apparent = primitive && this.getPrimitiveInterface(primitive)

    return apparent && this.isMappedViewOf(type, apparent) && this.keepsIndexes(type, apparent)
      ? apparent
      : undefined
  }

  /**
   * The interface of the members of a primitive, also of a union of literals of one primitive
   * (`'a' | 'b'`, an enum) or of branded ones (`boolean & { __brand: 'Flag' }`), which a view of
   * them maps over.
   */
  private getPrimitiveInterface(type: Type): Type | undefined {
    if (type.flags & PRIMITIVE_FLAGS) {
      return this.checker.getApparentType(type)
    }

    if (!type.isUnionType()) {
      return undefined
    }

    const interfaces = this.getMembers(type).map((member) => {
      const primitive = (member.isIntersectionType() ? this.getMembers(member) : [member]).find(
        (m) => m.flags & PRIMITIVE_FLAGS,
      )
      return primitive && this.checker.getApparentType(primitive)
    })
    const [first] = interfaces

    return first && interfaces.every((i) => i?.id === first.id) ? first : undefined
  }

  /**
   * The types a mapped type maps over: the members of its source when it is an intersection
   * (`Date` and `{ x }` of `Readonly<Date & { x }>`), else the source. A conditional type
   * resolving to a mapped type (`T extends object ? { [K in keyof T]: ... } : T`) keeps no trace of
   * an intersection it maps over, whose members are found by the declarations of its properties
   * instead (`Holder` and `Ext` of `DeepReadonly<Holder & Ext>`, or the `Number` members and the
   * brand of `DeepReadonly<number & { __brand: 'Id' }>`), when it keeps their values.
   */
  getMappedSourceMembers(type: Type): readonly Type[] {
    if (!((type as any).objectFlags & ObjectFlags.Mapped)) {
      return []
    }

    return this.memo('mappedSourceMembers', type.id, (): readonly Type[] => {
      const source = this.getMappedSource(type)
      const innermost = source ?? type

      if ((innermost as any).objectFlags & ObjectFlags.Mapped) {
        const owners = this.getKeptOwners(innermost)
        if (owners) {
          return owners
        }
      }

      return source === undefined
        ? []
        : source.isIntersectionType()
          ? this.getMembers(source)
          : [source]
    })
  }

  /**
   * The branded primitives whose brand declares a property of a type (`string & { __brand: 'Id' }`
   * declaring `__brand`), which a conditional mapped type over one has no other trace of
   * (`T extends object ? { readonly [K in keyof T]: ... } : T` over `Pick<Id, '__brand'>`).
   */
  getBrandedOwners(type: Type): readonly Type[] {
    return this.memo('brandedOwners', type.id, (): readonly Type[] => {
      const owners = new Map<number, Type>()

      for (const p of this.getProperties(type)) {
        for (const declaration of p.declarations) {
          const literal = (declaration.resolve() as any)?.parent
          const intersection = literal?.kind === SyntaxKind.TypeLiteral ? literal.parent : undefined
          const owner =
            intersection?.kind === SyntaxKind.IntersectionType
              ? this.checker.getTypeAtLocation(intersection)
              : undefined

          if (
            owner?.isIntersectionType() &&
            this.getMembers(owner).some((m) => m.flags & PRIMITIVE_FLAGS)
          ) {
            owners.set(owner.id, owner)
          }
        }
      }

      return [...owners.values()]
    })
  }

  /**
   * The types declaring the properties of a mapped type without a source, more than one, or one
   * besides properties no type declares (`x` of `Record<'x', number>` or of an object literal),
   * when it keeps the value of each of their properties.
   */
  private getKeptOwners(type: Type): readonly Type[] | undefined {
    const owners = this.getPropertyOwners(type)
    const properties = this.getProperties(type)

    // of each owner declaring it, a brand may narrow a member (`length` of `string & { length: 8 }`)
    const originals = properties.map((p) =>
      this.getSymbolTypes(
        owners.flatMap((o) => {
          const original = this.getProperty(o, p.name)
          return original ? [original] : []
        }),
      ),
    )
    const owned = properties.flatMap((_, i) => (originals[i]!.length ? [i] : []))

    if (!owners.length || (owners.length < 2 && owned.length === properties.length)) {
      return undefined
    }

    const values = this.getPropertyTypes(type)
    return this.keepsValues(
      owned.map((i) => values[i]),
      owned.map((i) => originals[i]!),
      true,
    )
      ? owners
      : undefined
  }

  /**
   * Whether each value keeps one of the originals at its index (see `keepsValue`), or the
   * intersection of several of them (`valueOf` of `number & { valueOf(): 1 }`), with `generic`,
   * also an original with type parameters, which match any type.
   */
  private keepsValues(
    values: readonly (Type | undefined)[],
    originals: readonly (readonly (Type | undefined)[])[],
    generic: boolean,
  ): boolean {
    const keepsOne = (value: Type, i: number) =>
      originals[i]!.some(
        (original) =>
          original !== undefined &&
          (this.keepsValue(value, original) || (generic && this.hasTypeParameter(original, 3))),
      )
    const keeps = (value: Type | undefined, i: number) =>
      value !== undefined &&
      (keepsOne(value, i) ||
        (originals[i]!.length > 1 &&
          value.isIntersectionType() &&
          this.getMembers(value).every((member) => keepsOne(member, i))))

    // values that are no mapped type first, which a mismatch shows without nesting deeper
    return (
      values.every((t, i) => nests(t) || keeps(t, i)) &&
      values.every((t, i) => !nests(t) || keeps(t, i))
    )
  }

  /**
   * The classes, interfaces, and object type literals declaring the properties of a type, without
   * the ones another of them derives from (`Base` of `class Holder extends Base`).
   */
  getPropertyOwners(type: Type): readonly Type[] {
    return this.memo('propertyOwners', type.id, (): readonly Type[] => {
      const owners = new Map<number, Type>()

      for (const p of this.getProperties(type)) {
        // also of the other declarations of a property of an intersection (the brand
        // redeclaring the `length` of `string & { length: 8 }`)
        for (const declaration of p.declarations) {
          const ownerType = this.getDeclarationOwner(p, true, declaration)
          if (ownerType !== undefined) {
            owners.set(ownerType.id, ownerType)
          }
        }
      }

      const keys = new Map(
        [...owners.values()].map((o) => [o, new Set(this.getProperties(o).map((p) => p.name))]),
      )

      // the most derived of the owners holding the same properties. A brand narrowing members
      // of a primitive (`string & { length: 8 }`) or of a class (`User & { id: 'fixed' }`) is
      // derived from neither.
      return [...keys].flatMap(([owner, names], i, all) =>
        all.some(
          ([other, otherNames], j) =>
            other !== owner &&
            !this.isPrimitiveInterface(other) &&
            [...names].every((name) => otherNames.has(name)) &&
            (otherNames.size > names.size || j < i) &&
            !(
              (owner.getSymbol()?.flags ?? 0) & SymbolFlags.TypeLiteral &&
              !this.checker.isTypeAssignableTo(other, owner)
            ),
        )
          ? []
          : [owner],
      )
    })
  }

  /**
   * Whether a type is the interface of a primitive's members, like `String`.
   */
  private isPrimitiveInterface(type: Type): boolean {
    const symbol = type.getSymbol()
    return (
      symbol !== undefined &&
      PRIMITIVE_INTERFACES.has(symbol.name) &&
      this.getSymbolSourceKind(symbol) === 'default'
    )
  }

  /**
   * The declared type of the class or interface declaring a property (by its first declaration),
   * also as a parameter property (`constructor(public a = 1)`) or in a class expression
   * (`const C = class { ... }`), and with `literals`, of an object type literal declaring it.
   */
  private getDeclarationOwner(
    property: TSSymbol,
    literals = false,
    declaration: TSSymbol['declarations'][number] | undefined = property.declarations[0],
  ): Type | undefined {
    const node = declaration?.resolve() as any
    // a parameter property is declared by the class of its constructor
    const owner =
      node?.kind === SyntaxKind.Parameter && node.parent?.kind === SyntaxKind.Constructor
        ? node.parent.parent
        : node?.parent

    if (!declaration || !owner) {
      return undefined
    }

    const location = `${declaration.path}:${owner.pos}`

    switch (owner.kind) {
      case SyntaxKind.TypeLiteral:
        return literals
          ? this.memo('ownerType', location, () => this.checker.getTypeAtLocation(owner))
          : undefined
      case SyntaxKind.ClassDeclaration:
      case SyntaxKind.InterfaceDeclaration:
        return owner.name
          ? this.memo('ownerType', location, () => {
              const symbol = this.checker.getSymbolAtLocation(owner.name)
              return symbol && this.checker.getDeclaredTypeOfSymbol(symbol)
            })
          : undefined
      case SyntaxKind.ClassExpression:
        // the instance type its construct signatures return
        return this.memo('ownerType', location, () => {
          const constructor = this.checker.getTypeAtLocation(owner)
          const [signature] = constructor
            ? this.checker.getSignaturesOfType(constructor, SignatureKind.Construct)
            : []
          return signature && this.checker.getReturnTypeOfSignature(signature)
        })
      default:
        return undefined
    }
  }

  /**
   * Whether a mapped type is a view of a type: it keeps its values (see `isMappedSourceOf`).
   */
  isMappedViewOf(type: Type, source: Type): boolean {
    return (
      Boolean(source.flags & (TypeFlags.Object | TypeFlags.Intersection)) &&
      Boolean((type as any).objectFlags & ObjectFlags.Mapped) &&
      this.keepsValue(type, source)
    )
  }

  /**
   * Whether a mapped type keeps the keys and values of a type (`T[K]`, maybe optional, or a deep
   * view of it, see `keepsValue`), with `generic`, also values of the source with type parameters,
   * which match any type.
   */
  private isMappedSourceOf(type: Type, source: Type, generic = false): boolean {
    if (!(source.flags & (TypeFlags.Object | TypeFlags.Intersection))) {
      return false
    }

    const sourceIndexes = new Map(this.getProperties(source).map((p, i) => [p.name, i]))
    const properties = this.getProperties(type)

    if (properties.some((p) => !sourceIndexes.has(p.name))) {
      return false
    }

    const sourceTypes = this.getPropertyTypes(source)
    return this.keepsValues(
      this.getPropertyTypes(type),
      properties.map((p) => [sourceTypes[sourceIndexes.get(p.name)!]]),
      generic,
    )
  }

  /**
   * Whether each index signature of a type is one of the source, with its value kept.
   */
  private keepsIndexes(type: Type, source: Type): boolean {
    const sourceInfos = this.checker.getIndexInfosOfType(source)

    return this.checker
      .getIndexInfosOfType(type)
      .every((info) =>
        sourceInfos.some(
          (s) => s.keyType.id === info.keyType.id && this.keepsValue(info.valueType, s.valueType),
        ),
      )
  }

  /**
   * The types of the properties of a type, in the order of `getProperties`.
   */
  getPropertyTypes(type: Type): readonly (Type | undefined)[] {
    return this.getSymbolTypes(this.getProperties(type))
  }

  /**
   * The types of symbols, like `checker.getTypeOfSymbol`, cached by symbol, requested together.
   */
  getSymbolTypes(symbols: readonly TSSymbol[]): (Type | undefined)[] {
    const missing = symbols.filter((s) => !this.symbolTypes.has(s.id))

    if (missing.length) {
      const fetched = this.checker.getTypeOfSymbol([...missing])
      missing.forEach((s, i) => this.symbolTypes.set(s.id, fetched[i]))
    }

    return symbols.map((s) => this.symbolTypes.get(s.id))
  }

  /**
   * A property of a type by its name, read from its properties once they were requested.
   */
  getProperty(type: Type, name: string): TSSymbol | undefined {
    const properties = this.memos.get('properties')?.get(type.id) as readonly TSSymbol[] | undefined

    if (properties) {
      return properties.find((p) => p.name === name)
    }

    return this.memo(`property:${name}`, type.id, () => this.checker.getPropertyOfType(type, name))
  }

  getNonNullable(type: Type): Type {
    // only a union, `null`, `undefined`, or a generic type may hold them
    if (!(type.flags & (TypeFlags.UnionOrIntersection | NULLISH_FLAGS | INSTANTIABLE_FLAGS))) {
      return type
    }

    return this.memo('nonNullable', type.id, () => this.checker.getNonNullableType(type) ?? type)
  }

  /**
   * Whether a value of a mapped type is still the value of its source: `T[K]`, maybe optional,
   * or a recursive mapped type over it (`DeepReadonly<T[K]>`), also over the members of a union
   * it distributes over, and the items of the arrays and read-only built-ins it maps them to
   * (type-fest's `ReadonlySet<ReadonlyDeep<V>>` for a `Set<V>`).
   *
   * A recursive type is kept unless a value shows otherwise: a pair being checked is assumed kept
   * inside its own check, and so is a pair whose source expands an instantiation it is nested in
   * (`DeepReadonly<Unfolding<T[]>>` inside `DeepReadonly<Unfolding<T>>`), like `ExpansionGuard`
   * cuts them. Results are cached by the pair, those relying on an assumption about an enclosing
   * pair only once that pair is found kept.
   */
  private keepsValue(value: Type, original: Type): boolean {
    if (value.id === original.id) {
      return true
    }

    const kept = this.getNonNullable(value)
    const source = this.getNonNullable(original)

    if (kept.id === source.id) {
      return true
    }

    if (this.isIdentityViewOf(kept, source)) {
      return true
    }

    const key = `${kept.id}:${source.id}`
    const cached = this.keptValues.get(key)

    if (cached !== undefined) {
      return cached
    }

    // found kept assuming an enclosing pair that is still being checked, which this check
    // assumes too, so it is not checked again on every path until that pair is done
    const provisionalFrame = this.getAssumedFrame(this.provisionalPairs.get(key))

    if (provisionalFrame) {
      this.assumedDepth = Math.min(this.assumedDepth, provisionalFrame.depth)
      return true
    }

    const pending = this.keeping.findIndex((frame) => frame.key === key)

    if (pending !== -1) {
      this.assumedDepth = Math.min(this.assumedDepth, pending)
      return true
    }

    const frame = this.createKeepingFrame(key, kept, source)

    if (frame.growth === undefined) {
      this.assumedDepth = Math.min(this.assumedDepth, frame.root)
      return true
    }

    const depth = this.keeping.length
    const outerAssumedDepth = this.assumedDepth
    const provisional = this.provisionallyKept.length

    this.keeping.push(frame)
    this.assumedDepth = Number.POSITIVE_INFINITY

    let result: boolean
    try {
      result = this.keepsStructure(kept, source)
    } finally {
      this.keeping.pop()
    }

    const assumedDepth = this.assumedDepth
    this.assumedDepth = Math.min(
      outerAssumedDepth,
      assumedDepth < depth ? assumedDepth : Number.POSITIVE_INFINITY,
    )

    if (!result) {
      // a pair is not kept whatever is assumed, but what was found assuming this one is not known
      for (const pair of this.provisionallyKept.splice(provisional)) {
        this.provisionalPairs.delete(pair.key)
      }
      this.keptValues.set(key, false)
    } else if (assumedDepth < depth) {
      // what was found assuming this pair now assumes the enclosing one
      frame.assumes = this.keeping[assumedDepth]!
      const pair = { key, frame: frame.assumes }
      this.provisionallyKept.push(pair)
      this.provisionalPairs.set(key, pair)
    } else {
      for (const pair of this.provisionallyKept.splice(provisional)) {
        this.provisionalPairs.delete(pair.key)
        this.keptValues.set(pair.key, true)
      }
      this.keptValues.set(key, true)
    }

    return result
  }

  /**
   * The frame a provisionally kept pair assumes kept, while it is still being checked: through
   * the frames it assumed that were found kept assuming an enclosing one.
   */
  private getAssumedFrame(pair: ProvisionalPair | undefined): KeepingFrame | undefined {
    let frame = pair?.frame

    while (frame && this.keeping[frame.depth] !== frame) {
      frame = frame.assumes
    }

    return frame
  }

  /**
   * Whether a mapped type is an instantiation over a type of an alias whose declaration keeps
   * every value of any type it maps over (see `getValueMapping`): `Readonly<T>`, `Pick<T, K>`,
   * or `DeepReadonly<T>` declared as `{ readonly [K in keyof T]: DeepReadonly<T[K]> }`, so none
   * of its values needs to be compared with the source's.
   */
  private isIdentityViewOf(value: Type, source: Type): boolean {
    if (!((value as any).objectFlags & ObjectFlags.Mapped) || source.flags & INSTANTIABLE_FLAGS) {
      return false
    }

    const alias = value.getAliasSymbol()
    const [argument] = alias ? value.getAliasTypeArguments() : []

    return (
      argument !== undefined &&
      (argument.id === source.id || this.getNonNullable(argument).id === source.id) &&
      this.getValueMapping(value)?.alias === alias!.id
    )
  }

  /**
   * The type a deep mapped type over itself (`DeepReadonly<DeepReadonly<X>>`) is the same as:
   * the inner one, as mapping each value once more changes nothing (see `getValueMapping`).
   */
  getFlattenedView(type: Type): Type {
    let current = type

    while ((current as any).objectFlags & ObjectFlags.Mapped) {
      const alias = current.getAliasSymbol()
      const [argument] = alias ? current.getAliasTypeArguments() : []

      if (
        !argument ||
        argument.getAliasSymbol()?.id !== alias!.id ||
        !((argument as any).objectFlags & ObjectFlags.Mapped)
      ) {
        break
      }

      const mapping = this.getValueMapping(current)
      if (mapping?.alias !== alias!.id || !mapping.deep) {
        break
      }

      current = argument
    }

    return current
  }

  /**
   * How a mapped type maps values, when its declaration is an alias mapping every value of its first
   * type parameter `T` to itself: `T[K]` (`Readonly<T>`, `Pick<T, K>`), or the alias over it
   * (`DeepReadonly<T[K]>`). Instantiations of a conditional type resolving to a mapped type have
   * no alias, so they are compared value by value.
   */
  private getValueMapping(type: Type): ValueMapping | undefined {
    const symbol = type.getSymbol()

    return (
      symbol &&
      this.memo('valueMapping', symbol.id, (): ValueMapping | undefined => {
        const mapped = symbol.declarations[0]?.resolve() as any

        if (mapped?.kind !== SyntaxKind.MappedType || mapped.nameType) {
          return undefined
        }

        const alias = mapped.parent
        const parameter = alias?.typeParameters?.[0]?.name?.text
        const key = mapped.typeParameter?.name?.text

        if (alias?.kind !== SyntaxKind.TypeAliasDeclaration || !parameter || !key) {
          return undefined
        }

        const aliasSymbol = this.checker.getSymbolAtLocation(alias.name)
        const template = mapped.type

        if (isIndexOf(template, parameter, key)) {
          return aliasSymbol && { alias: aliasSymbol.id, deep: false }
        }

        // the alias over the value: `DeepReadonly<T[K]>` of `{ readonly [K in keyof T]: ... }`
        const constraint = mapped.typeParameter.constraint

        if (
          template?.kind !== SyntaxKind.TypeReference ||
          template.typeArguments?.length !== 1 ||
          alias.typeParameters.length !== 1 ||
          !isIndexOf(template.typeArguments[0], parameter, key) ||
          constraint?.kind !== SyntaxKind.TypeOperator ||
          constraint.operator !== SyntaxKind.KeyOfKeyword ||
          !isTypeName(constraint.type, parameter)
        ) {
          return undefined
        }

        const referenced = this.checker.getSymbolAtLocation(template.typeName)
        return aliasSymbol && referenced?.id === aliasSymbol.id
          ? { alias: aliasSymbol.id, deep: true }
          : undefined
      })
    )
  }

  /**
   * A pair to check, with how often in a row its source grew an instantiation of the same
   * declaration it is nested in (`undefined` when it keeps expanding), and where that began.
   */
  private createKeepingFrame(key: string, value: Type, source: Type): KeepingFrame {
    const declaration = getDeclarationId(source)
    const valueDeclaration = getDeclarationId(value)
    const frame: KeepingFrame = {
      key,
      source,
      declaration,
      valueDeclaration,
      growth: 0,
      root: 0,
      depth: this.keeping.length,
    }

    if (declaration === undefined) {
      return frame
    }

    let nesting = 0
    let outer: KeepingFrame | undefined
    let outerDepth = -1

    for (let depth = this.keeping.length - 1; depth >= 0; depth--) {
      const candidate = this.keeping[depth]!
      if (
        candidate.declaration === declaration &&
        candidate.valueDeclaration === valueDeclaration
      ) {
        nesting++
        if (!outer) {
          outer = candidate
          outerDepth = depth
        }
      }
    }

    if (!outer) {
      frame.root = this.keeping.length
      return frame
    }

    frame.root = outer.growth ? outer.root : outerDepth
    const growth = argumentsGrow(this, outer.source, source) ? outer.growth! + 1 : 0
    frame.growth = growth >= MAX_GROWTH || nesting >= MAX_NESTING ? undefined : growth
    return frame
  }

  private keepsStructure(value: Type, source: Type): boolean {
    if (value.isUnionType() || source.isUnionType()) {
      const values = this.getUnionMembers(value)
      const sources = this.getUnionMembers(source)

      // each value is a source or a view of one (`T[K] | Readonly<T[K]>`), or a union widening one
      // with other values the source is assignable to (`T[K] | string`, `T[K] | T[K][]`)
      return (
        values.every((v) => sources.some((s) => this.keepsValue(v, s))) ||
        (value.isUnionType() &&
          values.some((v) => sources.some((s) => this.keepsValue(v, s))) &&
          this.checker.isTypeAssignableTo(source, value))
      )
    }

    // a literal widened to its primitive, `'a' | string` is `string`, also of an enum member,
    // whose base type is its enum
    if (
      source.flags &
      (TypeFlags.StringLiteral | TypeFlags.NumberLiteral | TypeFlags.BigIntLiteral)
    ) {
      const primitive =
        source.flags & TypeFlags.StringLiteral
          ? this.checker.getStringType()
          : source.flags & TypeFlags.NumberLiteral
            ? this.checker.getNumberType()
            : this.checker.getBigIntType()
      return (
        primitive.id === value.id || this.checker.getBaseTypeOfLiteralType(source)?.id === value.id
      )
    }

    if (!(value.flags & TypeFlags.Object)) {
      // an intersection the source is assignable to holds it, like the `(() => void) & { ... }`
      // type-fest's `ReadonlyDeep` maps a function with properties to
      return value.isIntersectionType() && this.checker.isTypeAssignableTo(source, value)
    }

    if ((value as any).objectFlags & ObjectFlags.Mapped) {
      // a mapped type over a generic type keeps its values only as the alias over it, found above
      // (`Readonly<Box<T>>`), not as one over an instantiation (`DeepPartial<Nest<number[]>>` of
      // `Nest<T[]>`, nested in the declared class a conditional type's mapped type is read as)
      return !this.hasTypeParameter(source, 3) && this.isMappedSourceOf(value, source)
    }

    const kind = this.getReferenceKind(value)
    const symbol = value.getSymbol()
    const sourceSymbol = source.getSymbol()
    const sameBuiltin =
      symbol !== undefined &&
      sourceSymbol !== undefined &&
      this.getSymbolSourceKind(symbol) === 'default' &&
      this.getSymbolSourceKind(sourceSymbol) === 'default' &&
      symbol.name.replace(/^Readonly/u, '') === sourceSymbol.name.replace(/^Readonly/u, '')

    if ((kind === undefined || kind !== this.getReferenceKind(source)) && !sameBuiltin) {
      // a value the source is still assignable to, like the `ReadonlyMap` type-fest's `PartialDeep`
      // maps a `URLSearchParams` to, holds it too
      return this.checker.isTypeAssignableTo(source, value)
    }

    const items = this.getReferenceArguments(value)
    const sourceItems = this.getReferenceArguments(source)

    return (
      items.length === sourceItems.length &&
      items.every((item, i) => this.keepsValue(item, sourceItems[i]!))
    )
  }

  private hasTypeParameter(type: Type, depth: number): boolean {
    if (type.flags & TypeFlags.TypeParameter) {
      return true
    }

    // a mapped type over keys of a type parameter (`{ [K in T]: true }` of zod's `BRAND<T>`,
    // `` { [K in `b-${T}`]: true } ``, `{ [K in T | 'extra']: true }`) as it is declared, or by an
    // alias over one (`Record<T | 'extra', true>`), unlike their instantiations and mapped types
    // over other keys (`{ [K in string]: number }`)
    if ((type as any).objectFlags & ObjectFlags.Mapped) {
      const declaration = type.getSymbol()?.declarations[0]?.resolve() as any
      const constraint = declaration?.typeParameter?.constraint
      const keys =
        constraint && this.checker.getTypeAtLocation(declaration)?.id === type.id
          ? this.checker.getTypeFromTypeNode(constraint)
          : undefined
      return (
        (keys !== undefined && this.involvesTypeParameter(keys, depth)) ||
        type.getAliasTypeArguments().some((argument) => this.involvesTypeParameter(argument, depth))
      )
    }

    // also the fields of an object type literal (`{ inner: { [K in T]: true } }`)
    const children =
      type.flags & TypeFlags.UnionOrIntersection
        ? this.getMembers(type)
        : (type.getSymbol()?.flags ?? 0) & SymbolFlags.TypeLiteral
          ? this.getPropertyTypes(type).filter((child) => child !== undefined)
          : this.getReferenceArguments(type)

    return depth > 0 && children.some((child) => this.hasTypeParameter(child, depth - 1))
  }

  /**
   * Whether a type is or holds a type parameter, also in the spans of a template literal, the
   * target of a string mapping (`Uppercase<T>`) or another generic type (`keyof T`).
   */
  private involvesTypeParameter(type: Type, depth: number): boolean {
    if (type.flags & INSTANTIABLE_FLAGS) {
      return true
    }

    const children =
      type.flags & (TypeFlags.UnionOrIntersection | TypeFlags.TemplateLiteral)
        ? (((type as any).getTypes() ?? []) as readonly Type[])
        : type.flags & TypeFlags.StringMapping
          ? [(type as any).getTarget() as Type]
          : undefined

    return children
      ? depth > 0 && children.some((child) => this.involvesTypeParameter(child, depth - 1))
      : this.hasTypeParameter(type, depth)
  }

  /**
   * The source of a mapped type: the first argument of the utility an alias of it is declared
   * with (`type View = Omit<Box<string>, 'x'>`), or else the class or interface declaring all
   * its properties.
   */
  private getDeclaringType(type: Type): Type | undefined {
    const declaration = type.getAliasSymbol()?.declarations[0]?.resolve() as any
    const argument = declaration?.type?.typeArguments?.[0]

    if (argument) {
      return this.checker.getTypeFromTypeNode(argument)
    }

    const properties = this.getProperties(type)

    if (!properties.length) {
      return undefined
    }

    const owners = new Map<number, Type>()

    for (const p of properties) {
      const owner = this.getDeclarationOwner(p)
      if (owner) {
        owners.set(owner.id, owner)
      }
    }

    // the most derived owner, which has every property
    for (const candidate of owners.values()) {
      const keys = new Set(this.getProperties(candidate).map((p) => p.name))

      if (properties.every((p) => keys.has(p.name))) {
        return candidate
      }
    }

    return undefined
  }

  /**
   * Whether only instances of a class are assignable to it: it has `#private`, `private`,
   * or `protected` members.
   */
  isNominalClass(type: Type): boolean {
    return this.memo('nominal', type.id, () =>
      this.getProperties(type).some(
        (p) =>
          p.escapedName.startsWith('__#') ||
          p.declarations.some((d) =>
            ((d.resolve() as any)?.modifiers ?? []).some(
              (m: any) =>
                m.kind === SyntaxKind.PrivateKeyword || m.kind === SyntaxKind.ProtectedKeyword,
            ),
          ),
      ),
    )
  }

  /**
   * Whether a type has call or construct signatures, like functions and classes.
   */
  isCallable(type: Type): boolean {
    return this.memo(
      'callable',
      type.id,
      () =>
        this.checker.getSignaturesOfType(type, SignatureKind.Call).length > 0 ||
        this.checker.getSignaturesOfType(type, SignatureKind.Construct).length > 0,
    )
  }

  getMembers(type: Type): readonly Type[] {
    return this.memo('members', type.id, (): readonly Type[] => (type as any).getTypes() ?? [])
  }

  /**
   * The members of a union, or the type itself.
   */
  getUnionMembers(type: Type): readonly Type[] {
    return type.isUnionType() ? this.getMembers(type) : [type]
  }

  /**
   * Whether the type is a union with a member of the flags.
   */
  hasMember(type: Type, flags: number): boolean {
    return type.isUnionType() && this.getMembers(type).some((m) => m.flags & flags)
  }

  getProperties(type: Type): readonly TSSymbol[] {
    return this.memo('properties', type.id, () => this.checker.getPropertiesOfType(type))
  }

  /**
   * The type arguments it was written with: of the alias (`Page<User>`), else of the reference.
   */
  getTypeArguments(type: Type): readonly Type[] {
    return type.getAliasSymbol() ? type.getAliasTypeArguments() : this.getReferenceArguments(type)
  }

  /**
   * The type arguments of a reference, like the `string` of `string[]`, even when it is aliased.
   */
  getReferenceArguments(type: Type): readonly Type[] {
    return this.memo('referenceArguments', type.id, () =>
      isTypeReference(type) ? this.checker.getTypeArguments(type as TypeReference) : [],
    )
  }

  getReferenceKind(type: Type): 'array' | 'tuple' | undefined {
    if (!isTypeReference(type)) {
      return undefined
    }

    return this.memo('referenceKind', type.id, () =>
      this.checker.isArrayType(type)
        ? 'array'
        : this.checker.isTupleType(type)
          ? 'tuple'
          : undefined,
    )
  }

  getGlobalType(name: string): Type | undefined {
    return this.memo('globalType', name, () => {
      const symbol = this.checker.resolveName(name, SymbolFlags.Type)
      return symbol && this.checker.getDeclaredTypeOfSymbol(symbol)
    })
  }

  /**
   * The type of a global's prototype, like `Array.prototype` (`any[]`) or `Set.prototype`
   * (`Set<any>`).
   */
  getPrototypeType(name: string): Type | undefined {
    return this.memo('prototypeType', name, () => {
      const constructor = this.checker.resolveName(name, SymbolFlags.Value)
      const [constructorType] = constructor ? this.getSymbolTypes([constructor]) : []
      const prototype = constructorType && this.getProperty(constructorType, 'prototype')
      return prototype && this.getSymbolTypes([prototype])[0]
    })
  }

  /**
   * The type of an enum with one member is that member's literal type.
   */
  getSingleMemberEnum(type: Type): TSSymbol | undefined {
    if (!(type.flags & TypeFlags.EnumLiteral) || type.flags & TypeFlags.Union) {
      return undefined
    }

    return this.memo('singleMemberEnum', type.id, () => {
      const parent = type.getSymbol()?.getParent()
      const isSingle =
        parent &&
        parent.flags & SymbolFlags.Enum &&
        this.checker.getDeclaredTypeOfSymbol(parent).id === type.id
      return isSingle ? parent : undefined
    })
  }

  getJSDoc(symbol: TSSymbol): JSDoc | undefined {
    return this.memo('jsdoc', symbol.id, () => getJSDoc(this.checker, symbol, this.getSourceKind))
  }

  /**
   * The type alias of the project without type parameters an object type without a name of its
   * own is declared with, which the compiler does not keep for it (`type User = InferSelectModel<typeof users>`),
   * of those of the files `readAliases` read: of the type, else the first one (see `preferAlias`)
   * of a type of the same shape, which the compiler instantiates anew where it infers or awaits it
   * (`Promise<User[]>`).
   */
  getLostAlias(type: Type): TSSymbol | undefined {
    const symbol = type.getSymbol()?.id ?? -1
    let asked = this.askedTypes.get(symbol)
    if (!asked) {
      this.askedTypes.set(symbol, (asked = new Map()))
    }
    asked.set(type.id, type)

    const aliases = this.lostAliases.get(symbol)
    const own = aliases?.get(type.id)
    if (!aliases || own) {
      return own?.[1]
    }

    const shape = this.getShape(type)
    let found: TSSymbol | undefined
    for (const [candidate, alias] of aliases.values()) {
      if (this.getShape(candidate) === shape) {
        found = preferAlias(found, alias)
      }
    }
    return found
  }

  /**
   * Whether an alias read since the last call names a type `getLostAlias` was asked about before,
   * so a conversion wrote it without the alias, or with another one.
   */
  takeLateAliases(): boolean {
    const late = this.lateAliases
    this.lateAliases = false
    return late
  }

  /**
   * The properties of a type, with whether they are optional and the ids of their types, which
   * tell apart the instantiations of one library type (`Simplify<...>` of drizzle), of one symbol.
   */
  private getShape(type: Type): string {
    return this.memo('shape', type.id, () => {
      const types = this.getPropertyTypes(type)
      return this.getProperties(type)
        .map((p, i) => `${p.name}\0${p.flags & SymbolFlags.Optional}\0${types[i]?.id}`)
        .join('\0')
    })
  }

  /**
   * Records the alias of a type, and whether a conversion may have written the type without it.
   */
  private addLostAlias(type: Type, alias: TSSymbol): void {
    const symbol = type.getSymbol()?.id ?? -1
    let aliases = this.lostAliases.get(symbol)
    if (!aliases) {
      this.lostAliases.set(symbol, (aliases = new Map()))
    }

    const existing = aliases.get(type.id)?.[1]
    const preferred = preferAlias(existing, alias)
    if (preferred === existing) {
      return
    }

    aliases.set(type.id, [type, preferred])
    const asked = this.askedTypes.get(symbol)
    this.lateAliases ||=
      !!asked &&
      (asked.has(type.id) ||
        [...asked.values()].some((t) => this.getShape(t) === this.getShape(type)))
  }

  /**
   * Reads the type aliases the project files of these declarations may write references to,
   * those they declare (at the top level or in namespaces) and those they import by name, for
   * `getLostAlias`. Each file is read once.
   */
  readAliases(declarations: readonly NodeHandle[]): void {
    const names: any[] = []
    const collect = (statements: readonly any[]): void => {
      for (const statement of statements) {
        if (statement.kind === SyntaxKind.TypeAliasDeclaration) {
          names.push(statement.name)
        } else if (statement.kind === SyntaxKind.ImportDeclaration) {
          const clause = statement.importClause
          names.push(
            ...(clause?.name ? [clause.name] : []),
            ...((clause?.namedBindings?.elements ?? []) as any[]).map((element) => element.name),
          )
        } else if (statement.kind === SyntaxKind.ModuleDeclaration) {
          // `namespace A.B {}` nests the declaration of `B` as the body of `A`
          let body = statement.body
          while (body?.kind === SyntaxKind.ModuleDeclaration) {
            body = body.body
          }
          collect(body?.statements ?? [])
        }
      }
    }

    for (const declaration of declarations) {
      if (
        !this.aliasFiles.has(declaration.path) &&
        this.getSourceKind(declaration.path) === 'project'
      ) {
        this.aliasFiles.add(declaration.path)
        collect(declaration.resolve()?.getSourceFile().statements ?? [])
      }
    }

    if (!names.length) {
      return
    }

    const aliases: TSSymbol[] = []
    const aliasNames: any[] = []
    for (const symbol of this.checker.getSymbolAtLocation(names)) {
      const alias = symbol && resolveAlias(this.checker, symbol)

      if (
        !alias ||
        !(alias.flags & SymbolFlags.TypeAlias) ||
        this.aliasSymbols.has(alias.id) ||
        this.getSymbolSourceKind(alias) !== 'project'
      ) {
        continue
      }

      this.aliasSymbols.add(alias.id)
      // a value of the same name, like a schema, can be declared first
      const node = alias.declarations
        .map((declaration) => declaration.resolve() as any)
        .find((node) => node?.kind === SyntaxKind.TypeAliasDeclaration)
      if (node && !node.typeParameters?.length && LOSING_ALIAS_KINDS.has(node.type.kind)) {
        aliases.push(alias)
        aliasNames.push(node.name)
      }
    }

    if (!aliases.length) {
      return
    }

    const types = this.checker.getTypeAtLocation(aliasNames)
    for (const [i, alias] of aliases.entries()) {
      const type = types[i]
      // an alias the compiler keeps names the type by itself, and so does an interface or a class
      // (of a library, or a built-in)
      if (
        type &&
        type.flags & (TypeFlags.Object | TypeFlags.Intersection) &&
        type.getAliasSymbol()?.id !== alias.id &&
        !((type.getSymbol()?.flags ?? 0) & (SymbolFlags.Interface | SymbolFlags.Class))
      ) {
        this.addLostAlias(type, alias)
      }
    }
  }

  /**
   * The project type alias the type annotation of a property names (`count?: Count | null`),
   * with its instantiated type (`Maybe<string>` rather than `T | null`).
   */
  getAnnotation(property: TSSymbol): PropertyAnnotation | undefined {
    return this.memo('annotation', property.id, (): PropertyAnnotation | undefined => {
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
      const alias = symbol && resolveAlias(this.checker, symbol)

      if (
        !alias ||
        !(alias.flags & SymbolFlags.TypeAlias) ||
        this.getSymbolSourceKind(alias) !== 'project'
      ) {
        return undefined
      }

      const type = this.checker.getTypeAtLocation(typeNode)
      const typeArguments = ((typeNode.typeArguments ?? []) as any[]).flatMap(
        (node) => this.checker.getTypeFromTypeNode(node) ?? [],
      )
      return type ? { alias, type, typeArguments } : undefined
    })
  }
}

/**
 * Of two aliases of a type, the one of the first file by path, else the first one it declares, so
 * the one chosen does not depend on the order the files are read in.
 */
function preferAlias(a: TSSymbol | undefined, b: TSSymbol): TSSymbol {
  const declarationA = a?.declarations[0]
  const declarationB = b.declarations[0]

  return !a ||
    (declarationA &&
      declarationB &&
      (declarationB.path < declarationA.path ||
        (declarationB.path === declarationA.path && declarationB.index < declarationA.index)))
    ? b
    : a
}

/** Whether comparing a value with its source may nest deeper: a union or a mapped type */
function nests(type: Type | undefined): boolean {
  return (
    type !== undefined &&
    Boolean(type.flags & TypeFlags.Union || (type as any).objectFlags & ObjectFlags.Mapped)
  )
}

/** Whether a type node is a type parameter's name, without type arguments */
function isTypeName(node: any, name: string): boolean {
  return (
    node?.kind === SyntaxKind.TypeReference &&
    !node.typeArguments?.length &&
    node.typeName?.kind === SyntaxKind.Identifier &&
    node.typeName.text === name
  )
}

/** Whether a type node is `T[K]` */
function isIndexOf(node: any, parameter: string, key: string): boolean {
  return (
    node?.kind === SyntaxKind.IndexedAccessType &&
    isTypeName(node.objectType, parameter) &&
    isTypeName(node.indexType, key)
  )
}

/**
 * A type of an object literal expression (`{ a: 1 }`), whose values are plain objects.
 */
export function isObjectLiteral(type: Type): boolean {
  return Boolean((type.getSymbol()?.flags ?? 0) & SymbolFlags.ObjectLiteral)
}

/**
 * The alias, interface, class, or enum a type is named by.
 */
export function getNamedSymbol(type: Type): TSSymbol | undefined {
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
