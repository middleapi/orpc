import type { Type } from 'typescript/unstable/sync'
import { ObjectFlags, TypeFlags } from 'typescript/unstable/sync'

import type { TypeQueries } from './type-queries.ts'

/** Nested instantiations of one declaration, like `Maybe<A>` inside `Maybe<B>` */
const MAX_NESTING = 16
/** Distinct instantiations nested in one outermost instantiation, once nested this deep */
const MAX_INSTANTIATIONS = 256
const MIN_BUDGET_NESTING = 4
/** Nested instantiations in a row whose type arguments contain the previous ones */
const MAX_GROWTH = 3

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
   * Converts a type inside the instantiations of its declaration,
   * returning `undefined` when the expansion is cut instead.
   */
  expand<T>(type: Type, convert: () => T): T | undefined {
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

    const growth = this.argumentsGrow(outer.type, type) ? outer.growth + 1 : 0
    return growth >= MAX_GROWTH ? undefined : growth
  }

  private argumentsGrow(outer: Type, inner: Type): boolean {
    const outerArguments = this.types.getTypeArguments(outer)

    return this.types
      .getTypeArguments(inner)
      .some((innerArgument) =>
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
      children = this.types.getMembers(type)
    } else if (
      type.flags & TypeFlags.Object &&
      (type as any).objectFlags & ObjectFlags.Anonymous &&
      !type.getAliasSymbol()
    ) {
      // `Thread<{ parent: T }>` grows through the literal's properties
      const properties = this.types.getProperties(type)
      children = properties.length ? this.types.checker.getTypeOfSymbol(properties) : []
    } else {
      children = this.types.getTypeArguments(type)
    }

    return children.some((child) => child !== undefined && this.containsType(child, id, depth - 1))
  }
}
