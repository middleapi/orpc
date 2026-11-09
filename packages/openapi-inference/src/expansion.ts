import type { Type } from 'typescript/unstable/sync'
import { ObjectFlags, TypeFlags } from 'typescript/unstable/sync'

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
}

/**
 * Cuts infinitely expanding generics: every instantiation of `type Expand<T> = { next: Expand<T[]> }`
 * is a new type, so converting it never comes back to a type it has seen.
 */
export class ExpansionGuard {
  /** How many expansions were cut, a conversion that cut one depends on where it started */
  cuts = 0

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
    const declaration: number = (type as any).aliasSymbol || (type as any).symbol

    if (!declaration) {
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
    stack.push({ type, growth })

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
        : 0
    return growth >= MAX_GROWTH ? undefined : growth
  }
}

/**
 * Whether the type arguments of an instantiation contain those of the instantiation it is
 * nested in (`Expand<string[]>` inside `Expand<string>`), so nesting it again never ends.
 */
export function argumentsGrow(types: TypeQueries, outer: Type, inner: Type, depth = 0): boolean {
  const outerArguments = types.getTypeArguments(outer)

  return types
    .getTypeArguments(inner)
    .some((innerArgument) =>
      outerArguments.some((outerArgument) => grows(types, outerArgument, innerArgument, depth)),
    )
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
    const declaration = getDeclaration(innerMember)
    return (
      declaration !== undefined &&
      outers.some(
        (outerMember) =>
          outerMember.id !== innerMember.id &&
          getDeclaration(outerMember) === declaration &&
          argumentsGrow(types, outerMember, innerMember, depth + 1),
      )
    )
  })
}

function getDeclaration(type: Type): number | undefined {
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
    const properties = types.getProperties(type)
    children = properties.length ? types.checker.getTypeOfSymbol(properties) : []
  } else {
    children = types.getTypeArguments(type)
  }

  return children.some((child) => child !== undefined && containsType(types, child, id, depth - 1))
}
