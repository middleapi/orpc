import type { Checker, Symbol as TSSymbol, Type } from 'typescript/unstable/sync'
import { TypeFlags } from 'typescript/unstable/sync'

import { getCallReturnType, getPromisedType } from './utils'

export interface ResolvedRouterType {
  type: Type
  /** The symbol the router or procedure is declared with, carrying its JSDoc */
  symbol: TSSymbol | undefined
}

/**
 * Reads procedure types structurally, so it works for procedures, contracts,
 * and lazy routers without resolving oRPC's own types by name.
 */
export class RouterTypeResolver {
  private readonly properties = new Map<string, Type | undefined>()

  constructor(
    private readonly checker: Checker,
    private readonly root: ResolvedRouterType,
  ) {}

  /**
   * Resolves the type at a router path, unwrapping lazy routers on the way.
   */
  resolve(path: readonly string[]): ResolvedRouterType | undefined {
    let current: ResolvedRouterType = { ...this.root, type: this.unlazy(this.root.type) }

    for (const segment of path) {
      const symbol = this.checker.getPropertyOfType(current.type, segment)

      // routers typed with an index signature, like `Record<string, typeof procedure>`
      const type = symbol
        ? this.checker.getTypeOfSymbol(symbol)
        : this.checker
            .getIndexInfosOfType(current.type)
            .find((info) => info.keyType.flags & TypeFlags.String)?.valueType

      if (!type) {
        return undefined
      }

      // optional sub-routers and procedures, like `...(dev ? { debug } : {})`
      current = { type: this.unlazy(this.stripNullish(type)), symbol }
    }

    return current
  }

  /**
   * Whether the type is a procedure or contract, which carries a `~orpc` definition.
   */
  isProcedure(type: Type): boolean {
    return this.getProperty(type, '~orpc') !== undefined
  }

  /**
   * Whether a procedure or contract is anywhere in the type, so a router of other paths
   * is told apart from an export that is no router at all.
   */
  holdsProcedure(type: Type = this.root.type, seen = new Set<number>()): boolean {
    const current = this.unlazy(this.stripNullish(type))

    if (seen.has(current.id)) {
      return false
    }

    seen.add(current.id)

    if (this.isProcedure(current)) {
      return true
    }

    if (current.isUnionType()) {
      return current.getTypes().some((member) => this.holdsProcedure(member, seen))
    }

    // primitives have no sub-routers, only the members of their wrapper types
    if (!(current.flags & TypeFlags.Object)) {
      return false
    }

    return (
      this.checker
        .getPropertiesOfType(current)
        .some((symbol) => this.holdsProcedure(this.checker.getTypeOfSymbol(symbol), seen)) ||
      this.checker
        .getIndexInfosOfType(current)
        .some((info) => this.holdsProcedure(info.valueType, seen))
    )
  }

  /**
   * The input or output type of a procedure, read from its `~orpc` definition.
   */
  getSchemaType(procedure: Type, direction: 'input' | 'output'): Type | undefined {
    const schema = this.getProperty(
      this.getProperty(
        this.getProperty(procedure, '~orpc'),
        direction === 'input' ? '__TInputSchema' : '__TOutputSchema',
      ),
      'type',
    )

    return this.getStandardSchemaType(schema, direction)
  }

  /**
   * The output type of an error's `data` schema.
   */
  getErrorDataType(procedure: Type, code: string): Type | undefined {
    const data = this.getProperty(
      this.getProperty(this.getProperty(this.getProperty(procedure, '~orpc'), 'errorMap'), code),
      'data',
    )

    return this.getStandardSchemaType(data, 'output')
  }

  private getStandardSchemaType(
    schema: Type | undefined,
    direction: 'input' | 'output',
  ): Type | undefined {
    const types = this.getProperty(this.getProperty(schema, '~standard'), 'types')
    // the input/output type itself is kept as is, including `null` and `undefined`
    const symbol = types && this.checker.getPropertyOfType(types, direction)
    return symbol && this.checker.getTypeOfSymbol(symbol)
  }

  /**
   * Gets the non-nullable type of a property, so optional properties can be followed.
   */
  private getProperty(type: Type | undefined, name: string): Type | undefined {
    if (!type) {
      return undefined
    }

    const key = `${type.id}:${name}`

    if (!this.properties.has(key)) {
      this.properties.set(key, this.getPropertyUncached(type, name))
    }

    return this.properties.get(key)
  }

  private getPropertyUncached(type: Type, name: string): Type | undefined {
    const symbol = this.checker.getPropertyOfType(type, name)
    const propertyType = symbol && this.checker.getTypeOfSymbol(symbol)

    return propertyType && this.stripNullish(propertyType)
  }

  private stripNullish(type: Type): Type {
    if (!type.isUnionType()) {
      return type
    }

    const members = type.getTypes()
    const concrete = members.filter((t) => !(t.flags & (TypeFlags.Undefined | TypeFlags.Null)))

    if (concrete.length === members.length) {
      return type
    }

    // `Procedure | undefined` needs no compiler request
    return concrete.length === 1 ? concrete[0]! : (this.checker.getNonNullableType(type) ?? type)
  }

  private unlazy(type: Type): Type {
    const loader = this.getProperty(this.getProperty(type, '~orpc'), 'loader')

    if (!loader) {
      return type
    }

    const promise = getCallReturnType(this.checker, loader)
    const resolved = promise && getPromisedType(this.checker, promise)
    const loaded = resolved ? this.getProperty(resolved, 'default') : undefined

    return loaded ? this.unlazy(loaded) : type
  }
}
