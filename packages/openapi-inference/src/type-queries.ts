import { SyntaxKind } from 'typescript/unstable/ast'
import type {
  Checker,
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
 * The project type alias a property's type annotation names, with the type it has there.
 */
export interface PropertyAnnotation {
  alias: TSSymbol
  type: Type
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

  private readonly globalTypes = new Map<string, Type | undefined>()
  private readonly memos = new Map<string, Map<number, unknown>>()
  private readonly ownerTypes = new Map<string, Type | undefined>()
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
   * Caches a result by the id of a type or symbol, under a kind of question.
   */
  memo<T>(kind: string, id: number, compute: () => T): T {
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
    const apparent =
      primitive && primitive.flags & PRIMITIVE_FLAGS
        ? this.checker.getApparentType(primitive)
        : undefined

    return apparent && this.isMappedViewOf(type, apparent) && this.keepsIndexes(type, apparent)
      ? apparent
      : undefined
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
  private getPropertyOwners(type: Type): readonly Type[] {
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
          ? this.getOwnerTypeBy(location, () => this.checker.getTypeAtLocation(owner))
          : undefined
      case SyntaxKind.ClassDeclaration:
      case SyntaxKind.InterfaceDeclaration:
        return owner.name ? this.getOwnerType(location, owner.name) : undefined
      case SyntaxKind.ClassExpression:
        // the instance type its construct signatures return
        return this.getOwnerTypeBy(location, () => {
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
   * The type declaring properties at a location, computed once.
   */
  private getOwnerTypeBy(location: string, compute: () => Type | undefined): Type | undefined {
    if (!this.ownerTypes.has(location)) {
      this.ownerTypes.set(location, compute())
    }

    return this.ownerTypes.get(location)
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
  private getPropertyTypes(type: Type): readonly (Type | undefined)[] {
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

  private getNonNullable(type: Type): Type {
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
      const values = value.isUnionType() ? this.getMembers(value) : [value]
      const sources = source.isUnionType() ? this.getMembers(source) : [source]

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
      return false
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

    const children =
      type.flags & TypeFlags.UnionOrIntersection
        ? this.getMembers(type)
        : this.getReferenceArguments(type)

    return depth > 0 && children.some((child) => this.hasTypeParameter(child, depth - 1))
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
   * The declared type of a class or interface, by the location of its declaration.
   */
  private getOwnerType(location: string, name: any): Type | undefined {
    return this.getOwnerTypeBy(location, () => {
      const symbol = this.checker.getSymbolAtLocation(name)
      return symbol && this.checker.getDeclaredTypeOfSymbol(symbol)
    })
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
    if (!this.globalTypes.has(name)) {
      const symbol = this.checker.resolveName(name, SymbolFlags.Type)
      this.globalTypes.set(name, symbol && this.checker.getDeclaredTypeOfSymbol(symbol))
    }

    return this.globalTypes.get(name)
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
      return type ? { alias, type } : undefined
    })
  }
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
