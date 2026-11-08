import { SyntaxKind } from 'typescript/unstable/ast'
import type { Symbol as TSSymbol, Type } from 'typescript/unstable/sync'
import { ObjectFlags, SignatureKind, SymbolFlags, TypeFlags } from 'typescript/unstable/sync'

import {
  getBuiltin,
  getBuiltinBaseName,
  getDeclaredBuiltinName,
  getMappedBuiltinName,
  getToJSON,
  isBuiltinSymbol,
  isModeSensitiveBuiltin,
} from './builtins.ts'
import type { TypeQueries } from './type-queries.ts'
import { INSTANTIABLE_FLAGS, isObjectLiteral, UNDEFINED_FLAGS } from './type-queries.ts'
import { getCallReturnType, isClassAccessor } from './utils.ts'

/*
 * How values are written as JSON: by the OpenAPI JSON serializer, or by `JSON.stringify`,
 * which the serializer leaves class instances to.
 */

const MAPPED_METHOD_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.MethodDeclaration,
  SyntaxKind.MethodSignature,
])

const MAPPED_ACCESSOR_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.GetAccessor,
  SyntaxKind.SetAccessor,
])

/**
 * The properties JSON serialization writes: no methods, symbol keys, #private fields,
 * or class accessors, and of a class instance, no members inherited from a built-in.
 */
export function getDataProperties(
  types: TypeQueries,
  properties: readonly TSSymbol[],
  classType: Type | undefined,
): TSSymbol[] {
  const isClassInstance = classType !== undefined
  // members of `Error` subclasses from packages are not data either (`ZodError#issues` is a getter)
  const isError = isClassInstance && getBuiltinBaseName(types, classType) === 'Error'

  return properties.filter(
    (p) =>
      !(p.flags & (SymbolFlags.Method | SymbolFlags.Prototype)) &&
      // symbol keys (`__@iterator@12`) and #private fields (`__#12@#secret`);
      // quoted keys starting with `__` are escaped with another `_`
      !p.escapedName.startsWith('__@') &&
      !p.escapedName.startsWith('__#') &&
      !isClassAccessor(p) &&
      // mapped types keep methods (`DeepPartial<Account>`) and class accessors (`Readonly<C>`)
      // as properties, still functions or on the prototype
      !(
        p.flags & SymbolFlags.Transient &&
        p.declarations.length > 0 &&
        p.declarations.every(
          (d) =>
            MAPPED_METHOD_KINDS.has(d.kind) ||
            (isClassInstance && MAPPED_ACCESSOR_KINDS.has(d.kind)),
        )
      ) &&
      // members inherited from a built-in class (`Error#message`, `Readable#readable`) are not own enumerable data
      !(isClassInstance && isBuiltinSymbol(types, p, isError)),
  )
}

/**
 * Whether JSON serialization drops a property of this type: `undefined`, functions,
 * and symbols, optionally mixed with `undefined` (`cb?: () => void`).
 */
export function isDropped(types: TypeQueries, type: Type): boolean {
  const members = type.isUnionType() ? types.getMembers(type) : [type]
  return members.every((m) => m.flags & UNDEFINED_FLAGS || isNonSerializable(types, m))
}

export function isNonSerializable(types: TypeQueries, type: Type): boolean {
  if (type.flags & TypeFlags.ESSymbolLike) {
    return true
  }

  if (
    !(type.flags & TypeFlags.Object) ||
    // object literals have no signatures
    isObjectLiteral(type) ||
    types.getReferenceKind(type) !== undefined
  ) {
    return false
  }

  // functions, also with properties (`{ (): void; displayName: string }`) or as constructors
  const symbol = type.getSymbol()
  if (symbol?.name === 'Function' && types.getSymbolSourceKind(symbol) === 'default') {
    return true
  }

  return types.isCallable(type)
}

/**
 * What `toJSON` of a value of this type returns, when it is called during serialization.
 * The serializer walks plain objects key by key, `JSON.stringify` calls their `toJSON` too.
 */
export function getToJSONResultType(
  types: TypeQueries,
  type: Type,
  stringify: boolean,
): Type | undefined {
  if (!(type.flags & (TypeFlags.Object | TypeFlags.Intersection))) {
    return undefined
  }

  // the serializer walks arrays and plain objects, also with a brand
  // (`string[] & { toJSON(): undefined }`), `JSON.stringify` calls their `toJSON`
  if (!stringify) {
    const members = type.isIntersectionType() ? types.getMembers(type) : [type]

    if (
      members.some((m) => types.getReferenceKind(m) !== undefined) ||
      members.every((m) => !(m.flags & TypeFlags.Object) || isObjectLiteral(m))
    ) {
      return undefined
    }
  }

  const toJSON = getToJSON(types, type)
  const method = toJSON && types.checker.getTypeOfSymbol(toJSON)

  // `Partial<Money>` maps the method to an optional property, the instance still has it
  const callable =
    method && method.isUnionType()
      ? types.getMembers(method).find((m) => !(m.flags & UNDEFINED_FLAGS))
      : method

  return getCallReturnType(types.checker, callable)
}

/**
 * Whether the `toJSON` of a type may be missing (`toJSON?(): string`, or `Partial<Money>`),
 * so a value is either what `toJSON` returns or its own fields.
 */
export function hasOptionalToJSON(types: TypeQueries, type: Type): boolean {
  const toJSON = getToJSON(types, type)
  const method = toJSON && types.checker.getTypeOfSymbol(toJSON)
  return Boolean(
    toJSON &&
    (toJSON.flags & SymbolFlags.Optional ||
      (method?.isUnionType() && types.getMembers(method).some((m) => m.flags & UNDEFINED_FLAGS))),
  )
}

/**
 * The class instance type of a type, also through `Readonly<C>`, `Pick<C, K>`, `C & { ... }`,
 * and `this`.
 */
export function getClassType(types: TypeQueries, type: Type): Type | undefined {
  const symbol = type.getSymbol()

  if (symbol && (symbol.flags & SymbolFlags.Class || isConstructedInterface(types, type, symbol))) {
    return type
  }

  // only instances of a class with `#private` members are assignable to an interface extending it
  if (symbol && symbol.flags & SymbolFlags.Interface) {
    const target = type.isTypeReference() ? type.getTarget() : type
    const privateBase = (target.getBaseTypes() ?? []).find((base) => {
      const classType = getClassType(types, base)
      return (
        classType && types.getProperties(classType).some((p) => p.escapedName.startsWith('__#'))
      )
    })

    if (privateBase) {
      return getClassType(types, privateBase)
    }
  }

  if (type.flags & TypeFlags.TypeParameter) {
    const constraint = types.checker.getBaseConstraintOfType(type)
    return constraint && constraint.id !== type.id ? getClassType(types, constraint) : undefined
  }

  if (type.isIntersectionType()) {
    for (const member of types.getMembers(type)) {
      const classType = getClassType(types, member)
      if (classType) {
        return classType
      }
    }
    return undefined
  }

  const source = types.getMappedSource(type)
  if (source) {
    return getClassType(types, source)
  }

  return undefined
}

/**
 * An interface with a constructor of the same name, the way libraries declare classes
 * (`interface TypeError` with `var TypeError: TypeErrorConstructor`, zod's `ZodError`),
 * unless the serializer handles it as a built-in, like `Date`, `Set`, or arrays.
 * Only declaration files of the default library and packages declare classes this way:
 * a project interface with a factory (`const User = model<User>()`) describes plain objects,
 * and the constructor must create the interface itself.
 */
function isConstructedInterface(types: TypeQueries, type: Type, symbol: TSSymbol): boolean {
  if (
    !(symbol.flags & SymbolFlags.Interface) ||
    !(symbol.flags & SymbolFlags.Variable) ||
    types.getReferenceKind(type) !== undefined
  ) {
    return false
  }

  const constructed = types.memo('constructed', symbol.id, () => {
    // the constructor comes from a declaration file, the interface may be augmented anywhere
    if (
      !symbol.declarations.some(
        (d) =>
          d.kind === SyntaxKind.VariableDeclaration && types.getSourceKind(d.path) !== 'project',
      )
    ) {
      return false
    }

    const value = types.checker.getTypeOfSymbol(symbol)
    const signatures = value
      ? types.checker.getSignaturesOfType(value, SignatureKind.Construct)
      : []

    return signatures.some((signature) => {
      const created = types.checker.getReturnTypeOfSignature(signature)
      return created !== undefined && createsInterface(types, created, symbol.name)
    })
  })

  return (
    constructed &&
    types.memo('builtin', type.id, () => getBuiltin(types, type, false) === undefined)
  )
}

/**
 * Whether a constructor's result is the interface of this name: by name, since the global
 * `Response` of the Node typings is constructed by undici's `Response`, also through
 * `Readonly<T>`, `T & { ... }`, a subclass, or a type parameter constrained to it.
 * effect's opaque schema types (`new (_: never): {}`) are not.
 */
function createsInterface(types: TypeQueries, type: Type, name: string, depth = 0): boolean {
  if (type.getSymbol()?.name === name) {
    return true
  }

  if (depth > 4) {
    return false
  }

  const next = (t: Type | undefined) =>
    t !== undefined && createsInterface(types, t, name, depth + 1)

  if (type.isIntersectionType()) {
    return types.getMembers(type).some(next)
  }

  if (type.flags & TypeFlags.TypeParameter) {
    return next(types.checker.getBaseConstraintOfType(type))
  }

  if ((type as any).objectFlags & ObjectFlags.Mapped) {
    return next(types.getTypeArguments(type)[0])
  }

  const target = type.isTypeReference() ? type.getTarget() : type
  return (target.getBaseTypes() ?? []).some(next)
}

/**
 * Whether types convert differently under `JSON.stringify` than under the serializer:
 * when they reach a `Set`, `Map`, `Blob`, `File`, or `bigint`, a built-in subclass serialized
 * through its own `toJSON`, or an object literal with `toJSON`. Class instances are always
 * converted under `JSON.stringify` rules, so they convert the same way either way.
 */
export class ModeSensitivity {
  private readonly cache = new Map<number, boolean>()
  /** Types on the current path, with their visit order, and whether they found a sensitive part */
  private readonly onPath = new Map<number, { order: number; sensitive: boolean }>()
  private readonly path: number[] = []
  private order = 0

  constructor(private readonly types: TypeQueries) {}

  isSensitive(type: Type): boolean {
    return this.visit(type).sensitive
  }

  /**
   * Types that refer to each other (a cycle) reach the same parts, so they share one answer,
   * decided once the first of them is done, like Tarjan's strongly connected components.
   * `low` is the earliest type on the path the visit came back to.
   */
  private visit(type: Type): { sensitive: boolean; low: number } {
    const cached = this.cache.get(type.id)

    if (cached !== undefined) {
      return { sensitive: cached, low: Infinity }
    }

    const current = this.onPath.get(type.id)

    if (current !== undefined) {
      return { sensitive: current.sensitive, low: current.order }
    }

    const entry = { order: this.order++, sensitive: false }
    this.onPath.set(type.id, entry)
    this.path.push(type.id)

    let low = entry.order
    entry.sensitive = this.compute(type, (child) => {
      const result = this.visit(child)
      low = Math.min(low, result.low)
      return result.sensitive
    })

    if (low < entry.order) {
      // part of a cycle that started earlier, its first type decides for all of them
      return { sensitive: entry.sensitive, low }
    }

    const members: number[] = []
    let sensitive = false

    for (let id = this.path.pop(); id !== undefined; id = this.path.pop()) {
      members.push(id)
      sensitive ||= this.onPath.get(id)!.sensitive
      if (id === type.id) {
        break
      }
    }

    for (const id of members) {
      this.onPath.delete(id)
      this.cache.set(id, sensitive)
    }

    return { sensitive, low: Infinity }
  }

  private compute(type: Type, isSensitive: (type: Type) => boolean): boolean {
    const types = this.types
    const flags = type.flags

    if (flags & TypeFlags.BigIntLike) {
      return true
    }

    if (flags & TypeFlags.UnionOrIntersection) {
      const members = types.getMembers(type)

      // `JSON.stringify` calls `toJSON` of an array (`string[] & { toJSON(): number }`)
      if (
        flags & TypeFlags.Intersection &&
        members.some((m) => types.getReferenceKind(m) !== undefined) &&
        getToJSON(types, type)
      ) {
        return true
      }

      // a class instance through `C & { ... }` is converted the same way either way
      return getClassType(types, type) === undefined && members.some(isSensitive)
    }

    if (flags & INSTANTIABLE_FLAGS) {
      const constraint = types.checker.getBaseConstraintOfType(type)
      return constraint !== undefined && constraint.id !== type.id && isSensitive(constraint)
    }

    if (!(flags & TypeFlags.Object)) {
      return false
    }

    if (types.getReferenceKind(type) !== undefined) {
      return types.getReferenceArguments(type).some(isSensitive)
    }

    if (getDeclaredBuiltinName(types, type) !== undefined) {
      return isModeSensitiveBuiltin(types, type)
    }

    const symbol = type.getSymbol()
    const classType = getClassType(types, type)
    // the class, or an interface extending a built-in (`interface Tags extends Set<string>`)
    const declared =
      classType ?? (symbol && symbol.flags & SymbolFlags.Interface ? type : undefined)
    const extended = declared && getBuiltinBaseName(types, declared)

    if (extended !== undefined) {
      if (isModeSensitiveBuiltin(types, declared!)) {
        return true
      }

      // `class Rows extends Array<Set<string>>` is an array of its items
      if (extended === 'Array' || extended === 'ReadonlyArray') {
        const item = types.checker
          .getIndexInfosOfType(type)
          .find((info) => info.keyType.flags & TypeFlags.Number)?.valueType
        return item !== undefined && isSensitive(item)
      }
    }

    // class instances are converted under `JSON.stringify` rules either way
    if (classType !== undefined) {
      return false
    }

    if (getMappedBuiltinName(types, type) !== undefined) {
      return isModeSensitiveBuiltin(types, type)
    }

    const properties = types.getProperties(type)
    const hasToJSON = properties.some((p) => p.name === 'toJSON')

    // the serializer skips `toJSON` of object literals, `JSON.stringify` calls it.
    // Other objects with `toJSON` are serialized through it either way.
    if (hasToJSON) {
      return isObjectLiteral(type)
    }

    const data = properties.filter((p) => !(p.flags & (SymbolFlags.Method | SymbolFlags.Prototype)))
    const dataTypes = data.length ? types.checker.getTypeOfSymbol(data) : []

    return (
      dataTypes.some((t) => t !== undefined && isSensitive(t)) ||
      types.checker.getIndexInfosOfType(type).some((info) => isSensitive(info.valueType))
    )
  }
}
