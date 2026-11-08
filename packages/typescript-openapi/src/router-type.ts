import type { Checker, Symbol as TSSymbol, Type } from 'typescript/unstable/sync'
import { SignatureKind } from 'typescript/unstable/sync'

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
      const type = symbol && this.checker.getTypeOfSymbol(symbol)

      if (!type) {
        return undefined
      }

      current = { type: this.unlazy(type), symbol }
    }

    return current
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

    const symbol = this.checker.getPropertyOfType(type, name)
    const propertyType = symbol && this.checker.getTypeOfSymbol(symbol)

    return propertyType && this.checker.getNonNullableType(propertyType)
  }

  private unlazy(type: Type): Type {
    const loader = this.getProperty(this.getProperty(type, '~orpc'), 'loader')

    if (!loader) {
      return type
    }

    const signature = this.checker.getSignaturesOfType(loader, SignatureKind.Call)[0]
    const promise = signature && this.checker.getReturnTypeOfSignature(signature)
    const resolved = promise?.isTypeReference() && this.checker.getTypeArguments(promise)[0]
    const loaded = resolved ? this.getProperty(resolved, 'default') : undefined

    return loaded ? this.unlazy(loaded) : type
  }
}
