import { SyntaxKind } from 'typescript/unstable/ast'
import type {
  Checker,
  Program,
  Symbol as TSSymbol,
  Type,
  TypeReference,
} from 'typescript/unstable/sync'
import { ObjectFlags, SignatureKind, SymbolFlags, TypeFlags } from 'typescript/unstable/sync'

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

  private readonly globalTypes = new Map<string, Type | undefined>()
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
   * The type a mapped type maps over by its own keys, like `T` of `Readonly<T>`, `Partial<T>`,
   * or `Pick<T, K>`, not the argument of `{ [K in 'data']: T }`, whose values are not `T`.
   */
  getMappedSource(type: Type): Type | undefined {
    return this.memo('mappedSource', type.id, () => {
      if (!((type as any).objectFlags & ObjectFlags.Mapped)) {
        return undefined
      }

      // `Readonly<C>` by its argument, an alias without arguments (`type View = Omit<C, 'x'>`)
      // by the declarations its properties keep
      const source = this.getTypeArguments(type)[0] ?? this.getDeclaringType(type)

      if (!source || !(source.flags & (TypeFlags.Object | TypeFlags.Intersection))) {
        return undefined
      }

      // the keys are the source's, and each value is the source's (`T[K]`, maybe optional)
      const sourceProperties = new Map(this.getProperties(source).map((p) => [p.name, p]))
      const properties = this.getProperties(type)
      const pairs = properties.map((p) => sourceProperties.get(p.name))

      if (pairs.some((p) => p === undefined)) {
        return undefined
      }

      const mappedTypes = properties.length ? this.checker.getTypeOfSymbol([...properties]) : []
      const sourceTypes = pairs.length ? this.checker.getTypeOfSymbol(pairs as TSSymbol[]) : []

      return mappedTypes.every((t, i) => {
        const original = sourceTypes[i]
        return (
          t !== undefined &&
          original !== undefined &&
          (t.id === original.id ||
            this.checker.getNonNullableType(t)?.id ===
              this.checker.getNonNullableType(original)?.id)
        )
      })
        ? source
        : undefined
    })
  }

  /**
   * The class or interface declaring the properties of a mapped type, which keeps them.
   */
  private getDeclaringType(type: Type): Type | undefined {
    const declaration = this.getProperties(type)[0]?.declarations[0]?.resolve() as any
    const owner = declaration?.parent
    const symbol =
      owner &&
      (owner.kind === SyntaxKind.ClassDeclaration ||
        owner.kind === SyntaxKind.InterfaceDeclaration) &&
      owner.name &&
      this.checker.getSymbolAtLocation(owner.name)

    return symbol ? this.checker.getDeclaredTypeOfSymbol(symbol) : undefined
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
