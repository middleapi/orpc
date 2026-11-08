import { SyntaxKind } from 'typescript/unstable/ast'
import type {
  Checker,
  Program,
  Symbol as TSSymbol,
  Type,
  TypeReference,
} from 'typescript/unstable/sync'
import { SignatureKind, SymbolFlags, TypeFlags } from 'typescript/unstable/sync'

import type { JSDoc, SourceKind } from './utils.ts'
import { createSourceKindChecker, getJSDoc, isTypeReference, resolveAlias } from './utils.ts'

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
 * Compiler requests the conversion repeats for the same types and symbols, cached by their id.
 */
export class TypeQueries {
  readonly getSourceKind: (path: string) => SourceKind

  private readonly membersCache = new Map<number, readonly Type[]>()
  private readonly propertiesCache = new Map<number, readonly TSSymbol[]>()
  private readonly typeArgumentsCache = new Map<number, readonly Type[]>()
  private readonly jsdocCache = new Map<number, JSDoc | undefined>()
  private readonly singleMemberEnumCache = new Map<number, TSSymbol | undefined>()
  private readonly annotationCache = new Map<number, PropertyAnnotation | undefined>()
  private readonly globalTypes = new Map<string, Type | undefined>()
  private readonly callableCache = new Map<number, boolean>()
  private readonly memos = new Map<string, Map<number, unknown>>()

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
   * Whether a type has call or construct signatures, like functions and classes.
   */
  isCallable(type: Type): boolean {
    let callable = this.callableCache.get(type.id)

    if (callable === undefined) {
      callable =
        this.checker.getSignaturesOfType(type, SignatureKind.Call).length > 0 ||
        this.checker.getSignaturesOfType(type, SignatureKind.Construct).length > 0
      this.callableCache.set(type.id, callable)
    }

    return callable
  }

  getMembers(type: Type): readonly Type[] {
    let members = this.membersCache.get(type.id)

    if (members === undefined) {
      members = (type as any).getTypes() ?? []
      this.membersCache.set(type.id, members!)
    }

    return members!
  }

  /**
   * Whether the type is a union with a member of the flags.
   */
  hasMember(type: Type, flags: number): boolean {
    return type.isUnionType() && this.getMembers(type).some((m) => m.flags & flags)
  }

  getProperties(type: Type): readonly TSSymbol[] {
    let properties = this.propertiesCache.get(type.id)

    if (properties === undefined) {
      properties = this.checker.getPropertiesOfType(type)
      this.propertiesCache.set(type.id, properties)
    }

    return properties
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
    let args = this.typeArgumentsCache.get(type.id)

    if (args === undefined) {
      args = isTypeReference(type) ? this.checker.getTypeArguments(type as TypeReference) : []
      this.typeArgumentsCache.set(type.id, args)
    }

    return args
  }

  getReferenceKind(type: Type): 'array' | 'tuple' | undefined {
    if (!isTypeReference(type)) {
      return undefined
    }

    return this.checker.isArrayType(type)
      ? 'array'
      : this.checker.isTupleType(type)
        ? 'tuple'
        : undefined
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

    if (!this.singleMemberEnumCache.has(type.id)) {
      const parent = type.getSymbol()?.getParent()
      const isSingle =
        parent &&
        parent.flags & SymbolFlags.Enum &&
        this.checker.getDeclaredTypeOfSymbol(parent).id === type.id
      this.singleMemberEnumCache.set(type.id, isSingle ? parent : undefined)
    }

    return this.singleMemberEnumCache.get(type.id)
  }

  getJSDoc(symbol: TSSymbol): JSDoc | undefined {
    if (!this.jsdocCache.has(symbol.id)) {
      this.jsdocCache.set(symbol.id, getJSDoc(this.checker, symbol, this.getSourceKind))
    }

    return this.jsdocCache.get(symbol.id)
  }

  /**
   * The project type alias the type annotation of a property names (`count?: Count | null`),
   * with its instantiated type (`Maybe<string>` rather than `T | null`).
   */
  getAnnotation(property: TSSymbol): PropertyAnnotation | undefined {
    if (this.annotationCache.has(property.id)) {
      return this.annotationCache.get(property.id)
    }

    let annotation: PropertyAnnotation | undefined
    const declaration = property.declarations[0]

    if (declaration && this.getSourceKind(declaration.path) === 'project') {
      let typeNode = (declaration.resolve() as any)?.type

      // `count?: Count | null`
      if (typeNode?.kind === SyntaxKind.UnionType) {
        const references = typeNode.types.filter((t: any) => t.kind === SyntaxKind.TypeReference)
        typeNode = references.length === 1 ? references[0] : undefined
      }

      if (typeNode?.kind === SyntaxKind.TypeReference) {
        const symbol = this.checker.getSymbolAtLocation(typeNode.typeName)
        const alias = symbol && resolveAlias(this.checker, symbol)

        if (
          alias &&
          alias.flags & SymbolFlags.TypeAlias &&
          this.getSymbolSourceKind(alias) === 'project'
        ) {
          const type = this.checker.getTypeAtLocation(typeNode)
          annotation = type ? { alias, type } : undefined
        }
      }
    }

    this.annotationCache.set(property.id, annotation)
    return annotation
  }
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
