import type { Symbol as TSSymbol, Type } from 'typescript/unstable/sync'
import { ObjectFlags, TypeFlags } from 'typescript/unstable/sync'

import { getIndexInfos } from './builtins'
import type { TypeQueries } from './type-queries'

/** Nested instantiations of one declaration, like `Maybe<A>` inside `Maybe<B>` */
export const MAX_NESTING = 64
/** Distinct instantiations nested in one outermost instantiation, once nested this deep */
const MAX_INSTANTIATIONS = 256
const MIN_BUDGET_NESTING = 4
/** Nested instantiations in a row whose type arguments contain the previous ones */
export const MAX_GROWTH = 3

interface Expansion {
  type: Type
  /** How many times in a row the type arguments grew */
  growth: number
  /** How many properties were being converted when it was entered */
  at: number
}

/** What a type holds of an outer one (see `ExpansionGuard#holdsAgain`) */
interface Held {
  /** Some value contains the outer one's (`T[]` of `T`) */
  grows: boolean
  /** Some values were objects without keys, which show nothing of what they map */
  keyless: boolean
}

const HELD: Held = { grows: false, keyless: false }
const GROWN: Held = { grows: true, keyless: false }
const KEYLESS: Held = { grows: false, keyless: true }

/**
 * What all of the items hold together, `undefined` once one of them holds something else.
 */
function holdEach<T>(
  items: readonly T[],
  compare: (item: T, index: number) => Held | undefined,
): Held | undefined {
  let grows = false
  let keyless = false

  for (const [index, item] of items.entries()) {
    const held = compare(item, index)

    if (held === undefined) {
      return undefined
    }

    grows ||= held.grows
    keyless ||= held.keyless
  }

  return { grows, keyless }
}

/**
 * Cuts infinitely expanding generics: every instantiation of `type Expand<T> = { next: Expand<T[]> }`
 * is a new type, so converting it never comes back to a type it has seen.
 */
export class ExpansionGuard {
  /** How many expansions were cut, a conversion that cut one depends on where it started */
  cuts = 0
  /** The properties being converted, outermost first */
  readonly path: TSSymbol[] = []

  private readonly expansions = new Map<number, Expansion[]>()
  private readonly instantiations = new Map<number, Set<number>>()

  constructor(private readonly types: TypeQueries) {}

  reset(): void {
    this.instantiations.clear()
  }

  /**
   * The instantiations being expanded, which decide where an expansion inside is cut.
   */
  getContext(): string {
    let context = ''
    for (const stack of this.expansions.values()) {
      for (const entry of stack) {
        context += `${entry.type.id},`
      }
    }
    return context
  }

  /**
   * Converts a type inside the instantiations of its declaration,
   * returning `undefined` when the expansion is cut instead.
   */
  expand<T>(wrapper: Type, convert: () => T): T | undefined {
    // `Readonly<Expand<T[]>>` expands `Expand`, the library's mapped type only wraps it
    const type = this.unwrap(wrapper)
    const declaration = getDeclarationId(type)

    if (declaration === undefined) {
      return convert()
    }

    const stack = this.expansions.get(declaration) ?? []

    // the same type again (through a named def) is not an expansion, the cycle logic handles it
    if (stack.some((entry) => entry.type.id === type.id)) {
      return convert()
    }

    const growth = this.getGrowth(declaration, stack, type)

    if (growth === undefined) {
      this.cuts++
      return undefined
    }

    this.expansions.set(declaration, stack)
    stack.push({ type, growth, at: this.path.length })

    try {
      return convert()
    } finally {
      stack.pop()

      // the budget is per outermost instantiation, siblings (`A[]` next to `B[]`) are not nested
      if (!stack.length) {
        this.instantiations.delete(declaration)
      }
    }
  }

  /**
   * The type a default library mapped type (`Readonly<T>`, `Partial<T>`, `Pick<T, K>`) wraps,
   * also through several of them.
   */
  private unwrap(type: Type): Type {
    for (let depth = 0; depth < 8; depth++) {
      const symbol = type.getAliasSymbol() ?? type.getSymbol()
      const [argument] = this.types.getTypeArguments(type)

      if (
        !argument ||
        !((type as any).objectFlags & ObjectFlags.Mapped) ||
        !symbol ||
        this.types.getSymbolSourceKind(symbol) !== 'default'
      ) {
        return type
      }

      type = argument
    }

    return type
  }

  /**
   * Returns how often in a row the type arguments grew, or `undefined` when the expansion
   * should stop: a declaration coming back with type arguments that contain the previous ones
   * (`Expand<string>` -> `Expand<string[]>` -> ...), nesting too deep, or too many instantiations.
   * Distinct instantiations (`Maybe<A>` inside `Maybe<B>`) are fine.
   */
  private getGrowth(
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
    if (symbol && this.types.getSymbolSourceKind(symbol) === 'default') {
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

    // an instantiation over part of the arguments of the outer one (a mapped type inside the union
    // its alias distributes over) neither grows nor starts anew
    const growth = argumentsGrow(this.types, outer.type, type)
      ? outer.growth + 1
      : argumentsKept(this.types, outer.type, type)
        ? outer.growth
        : this.getRepeatedGrowth(stack, type)
    return growth >= MAX_GROWTH ? undefined : growth
  }

  /**
   * An instantiation whose type arguments show no growth (a conditional type resolved to a mapped
   * type has none, a library's mapped type over one, `ReadonlyObjectDeep<{ ... }>`, shows nothing)
   * grows when it maps again over what an outer one with the same keys maps over, as a different
   * type, which a cycle through it (`T extends object ? { [K in keyof T]:
   * X<T[K]> } : T` over a model holding `X<Model>`, also `X<Model<T>>`) expands without end. It
   * does when it holds at each key what the outer one holds there (a mapping of the same keys
   * again), or what that grows to (`T[]` of `T`), as far as `MAX_GROWTH` mappings in. Another
   * instantiation of a generic model (`Page<Post>` holding `Page<Comment>`) holds another model at
   * a key, and one nested in itself (`Box<Box<Box<number>>>`) another value once its end is that
   * near, so both are expanded in full.
   */
  private getRepeatedGrowth(stack: readonly Expansion[], type: Type): number {
    const keys = this.getKeys(type)

    if (keys === undefined) {
      return 0
    }

    // the innermost one it holds again, also past one holding something else, as a cycle that
    // swaps type arguments (`Model<U, T[]>` of `Model<T, U>`) holds them again only every other time
    for (let i = stack.length - 1; i >= 0; i--) {
      const outer = stack[i]!
      const held =
        this.getKeys(outer.type) === keys && this.holdsAgain(outer.type, type, MAX_GROWTH)
      if (held) {
        // what functions it holds is not known (see `holdsAgain`), a nesting of models that
        // differ only there (`Via<Via<number>>`) ends where it is written. Either way it grows
        // only where its path runs through a declaration naming the model again, not through its
        // type argument alone (`a` of `inner: { a: T; l: Model<T>[] }`)
        const unknown = held.keyless && !held.grows
        const path = this.path.slice(outer.at)
        return path.some((property, index) => {
          const owner = stack.filter((entry) => entry.at === outer.at + index).at(-1)?.type
          return (
            owner !== undefined &&
            (unknown || this.declaresNesting(property, owner)) &&
            // along the rest of the path and again from where it starts, back to the property
            this.declaresCycle(property, owner, [...path.slice(index + 1), ...path.slice(0, index)])
          )
        })
          ? // also as far as the ones between with the same keys grew, which take turns with it
            Math.max(
              ...stack
                .slice(i)
                .filter((entry) => this.getKeys(entry.type) === keys)
                .map((entry) => entry.growth),
            ) + 1
          : 0
      }
    }

    return 0
  }

  /**
   * Whether a property is declared, in the model holding it, with a type naming that model again
   * (`next: Model<T[]>[]`), also through a view of it (`b: Box<DeepReadonly<Model<T>>>` of
   * `interface Model<T> extends Base<DeepReadonly<Model<T>>>`) or another model, a cycle of
   * declarations a nesting without end needs. Of the properties of the types it is declared with,
   * only those the nesting runs through count (`a` of `inner: { a: T; m: Map<K, Model<T>> }`),
   * also where it repeats a type holding the model (`Box<{ a: T; m: Map<K, Model<T>> }>`).
   */
  private declaresCycle(property: TSSymbol, owner: Type, along: readonly TSSymbol[]): boolean {
    // the whole route, which `reaches` ends as it takes one of its properties at each step
    const names = along.map((p) => p.name)
    return this.types.getPropertyOwners(owner).some((model) => {
      const declaration = getDeclarationId(model)
      const declared =
        declaration !== undefined && this.types.checker.getPropertyOfType(model, property.name)

      return (
        !!declared &&
        this.types.memo(`declaresCycle:${names.join('.')}`, declared.id, () => {
          const type = this.types.checker.getTypeOfSymbol(declared)
          return type !== undefined && this.reaches(type, declaration, 4, new Set(), names)
        })
      )
    })
  }

  /**
   * Whether a type is an instantiation of a declaration, or holds one `depth` types in: as a
   * member, a type argument, the model a view maps over, or a property of a type the project
   * declares. When given, only the property named first `along` the path counts, also for the
   * type arguments of a model of the project holding it, and none at its end, and the path, however
   * long, takes none of the `depth` (`c: { d: Box<View<Other<T>>> }` of a model `Other` holds again
   * at `c.d.v.e.f`).
   */
  private reaches(
    type: Type,
    declaration: number,
    depth: number,
    seen: Set<number>,
    along: readonly string[] | undefined,
  ): boolean {
    if (getDeclarationId(type) === declaration) {
      return true
    }

    if (depth === 0 || seen.has(type.id)) {
      return false
    }

    // a type passed again along other properties is not the same
    if (!along) {
      seen.add(type.id)
    }

    if (type.flags & TypeFlags.UnionOrIntersection) {
      return this.types
        .getMembers(type)
        .some((member) => this.reaches(member, declaration, along ? depth : depth - 1, seen, along))
    }

    const symbol = type.getAliasSymbol() ?? type.getSymbol()
    const library = symbol !== undefined && this.types.getSymbolSourceKind(symbol) === 'default'
    const mapped = (type as any).objectFlags & ObjectFlags.Mapped
    // along the path, a model of the project holds its type arguments only at the properties it
    // goes through (`v` of `Box<{ a: T; m: Map<K, Model<T>> }>` holds no `Model`), and none at its
    // end, a view all of them, as do a tuple and a type holding them where the path names no
    // property of the project (the values of `Dict<T>`, the items of `List<T> extends Array<T>`)
    const model =
      along !== undefined &&
      symbol !== undefined &&
      type.flags & TypeFlags.Object &&
      !library &&
      !mapped &&
      this.types.getReferenceKind(type) === undefined &&
      this.namesProperty(type, along[0])
    const children = [
      ...(model ? [] : this.types.getTypeArguments(type)),
      // the models a view maps over (`DeepReadonly<Model<T>>`), by its keys
      ...(mapped ? this.types.getPropertyOwners(type) : []),
    ]

    if (children.some((child) => this.reaches(child, declaration, depth - 1, seen, undefined))) {
      return true
    }

    if (!(type.flags & TypeFlags.Object) || library || along?.length === 0) {
      return false
    }

    // the values of index signatures, which the path does not name
    if (
      getIndexInfos(this.types, type).some((info) =>
        this.reaches(info.valueType, declaration, depth - 1, seen, along),
      )
    ) {
      return true
    }

    if (along) {
      const property = this.types.getProperty(type, along[0]!)
      const [next] = property ? this.types.getSymbolTypes([property]) : []
      return next !== undefined && this.reaches(next, declaration, depth, seen, along.slice(1))
    }

    return this.types
      .getPropertyTypes(type)
      .some((child) => child && this.reaches(child, declaration, depth - 1, seen, undefined))
  }

  /**
   * Whether a type has a property of a name the project declares, not one of a library type it
   * extends (`length` of `interface List<T> extends Array<T>`), or without a name, only such
   * properties and no index signature.
   */
  private namesProperty(type: Type, name: string | undefined): boolean {
    const declares = (property: TSSymbol | undefined): boolean =>
      property !== undefined && this.types.getSymbolSourceKind(property) !== 'default'

    return name === undefined
      ? getIndexInfos(this.types, type).length === 0 &&
          this.types.getProperties(type).some(declares)
      : declares(this.types.getProperty(type, name))
  }

  /**
   * Whether a type holds what an outer one holds, or what it grows to (see `getRepeatedGrowth`):
   * the same type, one containing it, the same members, type arguments, or keys, with the values
   * at them, `depth` objects in, `undefined` when it holds something else. A deep mapped type maps
   * a function (also a method of `Map<K, V>`) to a new `{}` for each instantiation, which shows
   * nothing of the function: two of them hold the same only as far as is known, as two functions
   * returning other models (`f: () => Via<T>`) differ.
   */
  private holdsAgain(outer: Type, inner: Type, depth: number): Held | undefined {
    if (outer.id === inner.id) {
      return HELD
    }

    // `T[]` of `T`, not any value holding `undefined` of a `T | undefined`
    if (
      !(outer.flags & (TypeFlags.Undefined | TypeFlags.Null | TypeFlags.Void)) &&
      containsType(this.types, inner, outer.id, 3)
    ) {
      return GROWN
    }

    if (outer.flags & TypeFlags.UnionOrIntersection) {
      const outers = this.types.getMembers(outer)
      const inners = this.types.getMembers(inner)
      return (outer.flags & TypeFlags.UnionOrIntersection) ===
        (inner.flags & TypeFlags.UnionOrIntersection) && outers.length === inners.length
        ? holdEach(inners, (i) => {
            for (const o of outers) {
              const held = this.holdsAgain(o, i, depth)
              if (held) {
                return held
              }
            }
            return undefined
          })
        : undefined
    }

    if (!(outer.flags & TypeFlags.Object) || !(inner.flags & TypeFlags.Object)) {
      return undefined
    }

    if (outer.isTypeReference() || inner.isTypeReference()) {
      const outerArguments = this.types.getReferenceArguments(outer)
      const innerArguments = this.types.getReferenceArguments(inner)
      return outer.isTypeReference() &&
        inner.isTypeReference() &&
        outer.getTarget().id === inner.getTarget().id &&
        outerArguments.length === innerArguments.length
        ? holdEach(innerArguments, (i, index) => this.holdsAgain(outerArguments[index]!, i, depth))
        : undefined
    }

    const keys = this.getKeys(outer)
    if (keys !== this.getKeys(inner)) {
      return undefined
    }

    if (keys === undefined) {
      return KEYLESS
    }

    if (depth === 0) {
      return HELD
    }

    const outerValues = this.getValues(outer)
    const innerValues = this.getValues(inner)
    return holdEach(innerValues, (value, index) => {
      const outerValue = outerValues[index]
      return value === undefined
        ? HELD
        : outerValue && this.holdsAgain(outerValue, value, depth - 1)
    })
  }

  /**
   * Whether a property is declared with a type that may nest a model in itself: one naming more
   * than the type parameters of its model (`next: Expanding<Model<T>> | null`, `nested: Pair<T[]>`),
   * not `v: T` or `items: T[]`, which nest only the type arguments a model is written with
   * (`Box<Box<Box<number>>>`), a finite type. In the declaration of the model holding it, also
   * through generic interfaces of them (`inner: Box<T>`), unless it inherits the property with
   * more (`a: Box<Der<T[]>>` of `interface Der<T> extends Base<Der<T[]>>`).
   */
  private declaresNesting(property: TSSymbol, owner: Type): boolean {
    const source = this.types.getMappedSource(owner) ?? owner
    const declaring = source.isTypeReference() ? source.getTarget() : source
    const declared = this.types.checker.getPropertyOfType(declaring, property.name)

    if (declared) {
      return this.types.memo('declaresNestingIn', declared.id, () => {
        const type = this.types.checker.getTypeOfSymbol(declared)
        return type !== undefined && !this.isParametric(type, 3, true)
      })
    }

    return this.types.memo('declaresNesting', property.id, () => {
      const name = (property.declarations[0]?.resolve() as any)?.name
      const original = name && this.types.checker.getSymbolAtLocation(name)
      const declared = this.types.checker.getTypeOfSymbol(original ?? property)
      return declared !== undefined && !this.isParametric(declared, 3)
    })
  }

  /**
   * Whether a type is made only of type parameters, primitives, and the default library's types
   * and object literals of them, also interfaces and classes of them with `interfaces`.
   */
  private isParametric(type: Type, depth: number, interfaces = false): boolean {
    if (type.flags & TypeFlags.UnionOrIntersection) {
      return this.types.getMembers(type).every((m) => this.isParametric(m, depth, interfaces))
    }

    if (type.flags & (TypeFlags.Conditional | TypeFlags.Substitution)) {
      return false
    }

    if (!(type.flags & TypeFlags.Object)) {
      return true
    }

    const symbol = type.getAliasSymbol() ?? type.getSymbol()
    const objectFlags = (type as any).objectFlags as number

    if (symbol && this.types.getSymbolSourceKind(symbol) === 'default') {
      return this.types.getTypeArguments(type).every((t) => this.isParametric(t, depth, interfaces))
    }

    if (
      depth === 0 ||
      type.getAliasSymbol() ||
      !(
        objectFlags &
        (interfaces
          ? ObjectFlags.Anonymous | ObjectFlags.Reference | ObjectFlags.Interface
          : ObjectFlags.Anonymous)
      ) ||
      objectFlags & ObjectFlags.Mapped
    ) {
      return false
    }

    // `{ inner: T }`, `{ [key: string]: T }`, or `Box<T>` of `interface Box<T> { v: T }`
    return this.getValues(type).every(
      (t) => t === undefined || this.isParametric(t, depth - 1, interfaces),
    )
  }

  /**
   * The declarations of the properties of a type, which a mapped type keeps from its source, and
   * the key types of its index signatures.
   */
  private getKeys(type: Type): string | undefined {
    return this.types.memo('expansionKeys', type.id, () => {
      const properties = this.types.getProperties(type)
      const indexes = getIndexInfos(this.types, type)
      return properties.length || indexes.length
        ? [
            ...properties.map((p) => {
              const declaration = p.declarations[0]
              return declaration ? `${declaration.path}:${declaration.index}` : p.name
            }),
            ...indexes.map((info) => `[${info.keyType.id}]`),
          ].join(',')
        : undefined
    })
  }

  /**
   * The values at the keys of a type (see `getKeys`).
   */
  private getValues(type: Type): readonly (Type | undefined)[] {
    return this.types.memo('expansionValues', type.id, () => [
      ...this.types.getPropertyTypes(type),
      ...getIndexInfos(this.types, type).map((info) => info.valueType),
    ])
  }
}

/**
 * Whether the type arguments of an instantiation contain those of the instantiation it is
 * nested in (`Expand<string[]>` inside `Expand<string>`), so nesting it again never ends.
 */
export function argumentsGrow(types: TypeQueries, outer: Type, inner: Type, depth = 0): boolean {
  const innerArguments = types.getTypeArguments(inner)
  const outerArguments = types.getTypeArguments(outer)

  return innerArguments.some((innerArgument, index) => {
    // one in its position as it is, or as part of it (`T` of `Model<Model<T, string>, string>`),
    // is held, not grown, though it holds another (`string`). One another grows into is not
    // (`Box<T>` of `Model<T, Box<T>>` inside `Model<T, U>`), also as another may be the same type
    // (`Pass<U, Box<T>>` of `Pass<number, number>`)
    const inPlace = outerArguments[index]
    return (
      (inPlace === undefined || !containsType(types, inPlace, innerArgument.id, 3)) &&
      outerArguments.some((outerArgument) => grows(types, outerArgument, innerArgument, depth))
    )
  })
}

/**
 * Whether the type arguments of an instantiation are those of the instantiation it is nested in,
 * or part of them (`DeepPartial<Nest<T>>` inside `DeepPartial<Nest<T> | null>`): the nesting
 * neither grows nor starts anew.
 */
function argumentsKept(types: TypeQueries, outer: Type, inner: Type): boolean {
  const innerArguments = types.getTypeArguments(inner)
  const outerArguments = types.getTypeArguments(outer)

  return (
    innerArguments.length > 0 &&
    innerArguments.every((innerArgument) =>
      outerArguments.some((outerArgument) =>
        containsType(types, outerArgument, innerArgument.id, 1),
      ),
    )
  )
}

/**
 * Whether a type argument contains the one it is nested in (`T[]` of `T`), also as the argument of
 * the same declaration (`Nest<T[]>` of `Nest<T>`), or of a member of a union (`Nest<T[]> | null`).
 */
function grows(types: TypeQueries, outer: Type, inner: Type, depth: number): boolean {
  if (inner.id === outer.id) {
    return false
  }

  if (containsType(types, inner, outer.id, 3)) {
    return true
  }

  if (depth >= 3) {
    return false
  }

  const inners = inner.flags & TypeFlags.UnionOrIntersection ? types.getMembers(inner) : [inner]
  const outers = outer.flags & TypeFlags.UnionOrIntersection ? types.getMembers(outer) : [outer]

  return inners.some((innerMember) => {
    const declaration = getDeclarationId(innerMember)
    return (
      declaration !== undefined &&
      outers.some(
        (outerMember) =>
          outerMember.id !== innerMember.id &&
          getDeclarationId(outerMember) === declaration &&
          argumentsGrow(types, outerMember, innerMember, depth + 1),
      )
    )
  })
}

/**
 * The declaration a type is an instantiation of: its alias, else its symbol.
 */
export function getDeclarationId(type: Type): number | undefined {
  return (type.getAliasSymbol() ?? type.getSymbol())?.id
}

function containsType(types: TypeQueries, type: Type, id: number, depth: number): boolean {
  if (type.id === id) {
    return true
  }

  if (depth === 0) {
    return false
  }

  let children: readonly (Type | undefined)[]

  if (type.flags & TypeFlags.UnionOrIntersection) {
    children = types.getMembers(type)
  } else if (
    type.flags & TypeFlags.Object &&
    (type as any).objectFlags & ObjectFlags.Anonymous &&
    !type.getAliasSymbol()
  ) {
    // `Thread<{ parent: T }>` grows through the literal's properties
    children = types.getPropertyTypes(type)
  } else {
    children = types.getTypeArguments(type)
  }

  return children.some((child) => child !== undefined && containsType(types, child, id, depth - 1))
}
