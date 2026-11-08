import { SyntaxKind } from 'typescript/unstable/ast'
import type { Symbol as TSSymbol, Type } from 'typescript/unstable/sync'
import { ObjectFlags, SymbolFlags, TypeFlags } from 'typescript/unstable/sync'

import {
  getBuiltinBaseName,
  getMappedBuiltinName,
  getToJSON,
  hasOwnToJSON,
  isBuiltinSymbol,
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

/** Built-ins the serializer handles, which `JSON.stringify` writes as `{}` */
const MODE_SENSITIVE_BUILTINS = new Set([
  'Set',
  'ReadonlySet',
  'Map',
  'ReadonlyMap',
  'Blob',
  'File',
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
  if (
    !(type.flags & (TypeFlags.Object | TypeFlags.Intersection)) ||
    types.getReferenceKind(type) !== undefined ||
    (isObjectLiteral(type) && !stringify)
  ) {
    return undefined
  }

  const toJSON = getToJSON(types, type)
  return toJSON && getCallReturnType(types.checker, types.checker.getTypeOfSymbol(toJSON))
}

/**
 * The class instance type of a type, also through `Readonly<C>`, `Pick<C, K>`, `C & { ... }`,
 * and `this`.
 */
export function getClassType(types: TypeQueries, type: Type): Type | undefined {
  if ((type.getSymbol()?.flags ?? 0) & SymbolFlags.Class) {
    return type
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

  if ((type as any).objectFlags & ObjectFlags.Mapped) {
    const [source] = types.getTypeArguments(type)
    return source && source.flags & TypeFlags.Object ? getClassType(types, source) : undefined
  }

  return undefined
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
      // a class instance through `C & { ... }` is converted the same way either way
      return getClassType(types, type) === undefined && types.getMembers(type).some(isSensitive)
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

    const symbol = type.getSymbol()

    // named built-ins, not the anonymous types of library aliases like `Partial<T>` or `Record<K, V>`
    if (
      symbol &&
      symbol.flags & (SymbolFlags.Interface | SymbolFlags.Class) &&
      isBuiltinSymbol(types, symbol)
    ) {
      return MODE_SENSITIVE_BUILTINS.has(symbol.name)
    }

    const classType = getClassType(types, type)
    // the class, or an interface extending a built-in (`interface Tags extends Set<string>`)
    const declared =
      classType ?? (symbol && symbol.flags & SymbolFlags.Interface ? type : undefined)
    const extended = declared && getBuiltinBaseName(types, declared)

    if (extended !== undefined) {
      if (MODE_SENSITIVE_BUILTINS.has(extended) || hasOwnToJSON(types, declared!)) {
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

    const mapped = getMappedBuiltinName(types, type)
    if (mapped !== undefined) {
      return MODE_SENSITIVE_BUILTINS.has(mapped)
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
