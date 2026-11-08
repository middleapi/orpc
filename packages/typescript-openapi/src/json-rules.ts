import { SyntaxKind } from 'typescript/unstable/ast'
import type { Symbol as TSSymbol, Type } from 'typescript/unstable/sync'
import { ObjectFlags, SignatureKind, SymbolFlags, TypeFlags } from 'typescript/unstable/sync'

import {
  getBuiltinBaseName,
  getMappedBuiltinName,
  getToJSON,
  hasOwnToJSON,
  isBuiltinMember,
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
      !(isClassInstance && isBuiltinMember(types, p, isError)),
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

function isNonSerializable(types: TypeQueries, type: Type): boolean {
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

  return (
    types.checker.getSignaturesOfType(type, SignatureKind.Call).length > 0 ||
    types.checker.getSignaturesOfType(type, SignatureKind.Construct).length > 0
  )
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
    !(type.flags & TypeFlags.Object) ||
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
  private readonly visiting = new Set<number>()
  private assumed = false

  constructor(private readonly types: TypeQueries) {}

  isSensitive(type: Type): boolean {
    const cached = this.cache.get(type.id)

    if (cached !== undefined) {
      return cached
    }

    // a cycle: assume no, and do not cache answers that relied on it
    if (this.visiting.has(type.id)) {
      this.assumed = true
      return false
    }

    const outerAssumed = this.assumed
    this.assumed = false
    this.visiting.add(type.id)

    let sensitive: boolean
    try {
      sensitive = this.compute(type)
    } finally {
      this.visiting.delete(type.id)
    }

    if (sensitive || !this.assumed) {
      this.cache.set(type.id, sensitive)
    }

    this.assumed = outerAssumed || (this.assumed && !sensitive)
    return sensitive
  }

  private compute(type: Type): boolean {
    const types = this.types
    const flags = type.flags

    if (flags & TypeFlags.BigIntLike) {
      return true
    }

    if (flags & TypeFlags.UnionOrIntersection) {
      return types.getMembers(type).some((m) => this.isSensitive(m))
    }

    if (flags & INSTANTIABLE_FLAGS) {
      const constraint = types.checker.getBaseConstraintOfType(type)
      return constraint !== undefined && constraint.id !== type.id && this.isSensitive(constraint)
    }

    if (!(flags & TypeFlags.Object)) {
      return false
    }

    if (types.getReferenceKind(type) !== undefined) {
      return types.getReferenceArguments(type).some((t) => this.isSensitive(t))
    }

    const symbol = type.getSymbol()

    if (symbol && isBuiltinSymbol(types, symbol)) {
      return MODE_SENSITIVE_BUILTINS.has(symbol.name)
    }

    if (symbol && symbol.flags & SymbolFlags.Class) {
      const base = getBuiltinBaseName(types, type)
      return base !== undefined && (MODE_SENSITIVE_BUILTINS.has(base) || hasOwnToJSON(types, type))
    }

    const mapped = getMappedBuiltinName(types, type)
    if (mapped !== undefined) {
      return MODE_SENSITIVE_BUILTINS.has(mapped)
    }

    const properties = types.getProperties(type)

    if (isObjectLiteral(type) && properties.some((p) => p.name === 'toJSON')) {
      return true
    }

    const data = properties.filter((p) => !(p.flags & (SymbolFlags.Method | SymbolFlags.Prototype)))
    const dataTypes = data.length ? types.checker.getTypeOfSymbol(data) : []

    return (
      dataTypes.some((t) => t !== undefined && this.isSensitive(t)) ||
      types.checker.getIndexInfosOfType(type).some((info) => this.isSensitive(info.valueType))
    )
  }
}
