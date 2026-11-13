import { SyntaxKind } from 'typescript/unstable/ast'
import type { Checker, Program, Symbol as TSSymbol, Type } from 'typescript/unstable/sync'
import { TypeFlags } from 'typescript/unstable/sync'

import { ExpansionGuard } from './expansion'
import { getIndexKeyType, toPattern } from './key-patterns'
import { TypeQueries } from './type-queries'
import { getAssignedSymbol, getCallReturnType, getPromisedType, isMappedType } from './utils'

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
  private readonly types: TypeQueries

  constructor(
    private readonly checker: Checker,
    program: Program,
    private readonly root: ResolvedRouterType,
  ) {
    this.types = new TypeQueries(checker, program)
  }

  /**
   * Resolves the type at a router path, unwrapping lazy routers on the way. A router typed `any`,
   * like one of an import the compiler does not find, is the type of its procedures too.
   */
  resolve(path: readonly string[]): ResolvedRouterType | undefined {
    let current: ResolvedRouterType = { ...this.root, type: this.unlazy(this.root.type) }

    for (const segment of path) {
      if (current.type.flags & TypeFlags.Any) {
        return current
      }

      const found = this.resolveSegment(current.type, segment)

      if (!found) {
        return undefined
      }

      // optional sub-routers and procedures, like `...(dev ? { debug } : {})`
      const type = this.stripNullish(found.type)
      const loaded = found.symbol && this.getWrittenLoadedAny(found.symbol, type)
      current = { type: loaded ?? this.unlazy(type), symbol: found.symbol }
    }

    return current
  }

  /**
   * The `any` the loader of a lazy router resolves as it is written, like the `import()` of a
   * module the compiler does not find, which the type of the lazy router does not show: it holds
   * a router of any procedures instead.
   */
  private getWrittenLoadedAny(symbol: TSSymbol, type: Type): Type | undefined {
    if (!this.getPath(type, ['~orpc', 'loader'])) {
      return undefined
    }

    return this.types.memo('writtenLoadedAny', symbol.id, () => {
      // `users: os.lazy(...)`, or `{ users }` and `users: usersRouter` of a variable
      const loaders = [symbol, getAssignedSymbol(this.checker, symbol)].flatMap((s) =>
        (s?.declarations ?? []).flatMap((declaration) => {
          const initializer = (declaration.resolve() as any)?.initializer
          return initializer?.kind === SyntaxKind.CallExpression ? [...initializer.arguments] : []
        }),
      )

      if (!loaders.length) {
        return undefined
      }

      return this.checker.getTypeAtLocation(loaders).flatMap((loader) => {
        const promise = getCallReturnType(this.checker, loader)
        const loaded = promise && getPromisedType(this.checker, promise)
        const router =
          loaded && !(loaded.flags & TypeFlags.Any)
            ? this.getPropertyType(loaded, 'default')
            : loaded
        return router && router.flags & TypeFlags.Any ? [router] : []
      })[0]
    })
  }

  private resolveSegment(type: Type, segment: string): ResolvedRouterType | undefined {
    const symbol = this.types.getProperty(type, segment)

    if (symbol) {
      const propertyType = this.types.getSymbolTypes([symbol])[0]
      return propertyType && { type: propertyType, symbol }
    }

    // routers of a union, like `isDev ? { ...base, debug } : base`, at a key only some members have
    if (type.isUnionType()) {
      const found = this.types
        .getMembers(type)
        .map((member) => this.resolveSegment(this.unlazy(member), segment))
        .filter((member) => member !== undefined)

      return found.every((member) => member.type.id === found[0]?.type.id) ? found[0] : undefined
    }

    // routers typed with an index signature, like `Record<string, typeof procedure>`
    const valueType = this.checker.getIndexInfosOfType(type).find((info) => {
      const key = getIndexKeyType(this.types, info.keyType)
      return key && new RegExp(`^(?:${toPattern(this.types, key)})$`, 'u').test(segment)
    })?.valueType

    return valueType && { type: valueType, symbol: undefined }
  }

  /**
   * Whether the type is a procedure or contract, which carries a `~orpc` definition.
   */
  isProcedure(type: Type): boolean {
    return this.getPath(type, ['~orpc']) !== undefined
  }

  /**
   * Whether a procedure or contract is anywhere in the type, so a router of other paths
   * is told apart from an export that is no router at all.
   */
  holdsProcedure(): boolean {
    return this.holdsProcedureIn(this.root.type, new ExpansionGuard(this.types), new Set())
  }

  private holdsProcedureIn(type: Type, expansion: ExpansionGuard, seen: Set<number>): boolean {
    const types = this.types
    const current = this.unlazy(this.stripNullish(type))

    if (seen.has(current.id)) {
      return false
    }

    seen.add(current.id)

    if (this.isProcedure(current)) {
      return true
    }

    // optional routers, and the `{ users } & { posts }` of `Object.assign`
    if (current.flags & TypeFlags.UnionOrIntersection) {
      return types
        .getMembers(current)
        .some((member) => this.holdsProcedureIn(member, expansion, seen))
    }

    if (!this.canBeRouter(current)) {
      return false
    }

    // every instantiation of `interface Grow<T> { next: Grow<T[]> }` is a new type
    return (
      expansion.expand(
        current,
        () =>
          types
            .getPropertyTypes(current)
            .some(
              (property) =>
                property !== undefined && this.holdsProcedureIn(property, expansion, seen),
            ) ||
          this.checker
            .getIndexInfosOfType(current)
            .some((info) => this.holdsProcedureIn(info.valueType, expansion, seen)),
      ) ?? false
    )
  }

  /**
   * Whether the type can hold routers like an object of procedures, lazy routers and nested
   * routers does: a plain object, a class instance or a function with properties, but no
   * primitive, array or default library type (`Record<K, T>` and the other mapped types aside),
   * whose members hold no procedure.
   */
  private canBeRouter(type: Type): boolean {
    if (!(type.flags & TypeFlags.Object) || this.types.getReferenceKind(type)) {
      return false
    }

    const symbol = type.getSymbol()

    return !symbol || isMappedType(type) || this.types.getSymbolSourceKind(symbol) !== 'default'
  }

  /**
   * The input or output type of a procedure, read from its `~orpc` definition.
   */
  getSchemaType(procedure: Type, direction: 'input' | 'output'): Type | undefined {
    const schema = direction === 'input' ? '__TInputSchema' : '__TOutputSchema'
    return this.getStandardSchemaType(this.getPath(procedure, ['~orpc', schema, 'type']), direction)
  }

  /**
   * The output type of an error's `data` schema.
   */
  getErrorDataType(procedure: Type, code: string): Type | undefined {
    const data = this.getPath(procedure, ['~orpc', 'errorMap', code, 'data'])
    return this.getStandardSchemaType(data, 'output')
  }

  private getStandardSchemaType(
    schema: Type | undefined,
    direction: 'input' | 'output',
  ): Type | undefined {
    const types = this.getPath(schema, ['~standard', 'types'])
    // the input/output type itself is kept as is, including `null` and `undefined`
    return types && this.getPropertyType(types, direction)
  }

  /**
   * Follows properties by their non-nullable types, so optional properties can be followed.
   */
  private getPath(type: Type | undefined, names: readonly string[]): Type | undefined {
    return names.reduce<Type | undefined>((current, name) => {
      const propertyType = current && this.getPropertyType(current, name)
      return propertyType && this.stripNullish(propertyType)
    }, type)
  }

  private getPropertyType(type: Type, name: string): Type | undefined {
    const symbol = this.types.getProperty(type, name)
    return symbol && this.types.getSymbolTypes([symbol])[0]
  }

  private stripNullish(type: Type): Type {
    if (!type.isUnionType()) {
      return type
    }

    const members = this.types.getMembers(type)
    const concrete = members.filter((t) => !(t.flags & (TypeFlags.Undefined | TypeFlags.Null)))

    if (concrete.length === members.length) {
      return type
    }

    // `Procedure | undefined` needs no compiler request
    return concrete.length === 1 ? concrete[0]! : this.types.getNonNullable(type)
  }

  private unlazy(type: Type): Type {
    return this.types.memo('unlazy', type.id, () => this.load(type))
  }

  private load(type: Type): Type {
    const loader = this.getPath(type, ['~orpc', 'loader'])

    if (!loader) {
      return type
    }

    const promise = getCallReturnType(this.checker, loader)
    const resolved = promise && getPromisedType(this.checker, promise)
    const loaded = this.getPath(resolved, ['default'])

    return loaded ? this.unlazy(loaded) : type
  }
}
