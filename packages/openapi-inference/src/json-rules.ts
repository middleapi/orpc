import { SyntaxKind } from 'typescript/unstable/ast'
import type { Symbol as TSSymbol, Type } from 'typescript/unstable/sync'
import { ObjectFlags, SignatureKind, SymbolFlags, TypeFlags } from 'typescript/unstable/sync'

import {
  extendsBuiltinClass,
  getBuiltin,
  getBuiltinBaseName,
  getDeclaredBuiltinName,
  getToJSON,
  hasBigIntToJSON,
  isBoxedBigInt,
  isBuiltinSymbol,
  isModeSensitiveBuiltin,
  isTypedArray,
} from './builtins.ts'
import { ExpansionGuard } from './expansion.ts'
import type { TypeQueries } from './type-queries.ts'
import {
  INSTANTIABLE_FLAGS,
  isObjectLiteral,
  NULLISH_FLAGS,
  UNDEFINED_FLAGS,
} from './type-queries.ts'
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
 * A getter, setter, or auto-accessor (`accessor x = 1`, a getter and setter pair on the prototype).
 */
function isAccessorDeclaration(declaration: TSSymbol['declarations'][number]): boolean {
  if (MAPPED_ACCESSOR_KINDS.has(declaration.kind)) {
    return true
  }

  return (
    declaration.kind === SyntaxKind.PropertyDeclaration &&
    ((declaration.resolve() as any)?.modifiers ?? []).some(
      (m: any) => m.kind === SyntaxKind.AccessorKeyword,
    )
  )
}

/**
 * The properties JSON serialization writes: no methods, symbol keys, #private fields,
 * or class accessors, and of a class instance, no members inherited from a built-in.
 * `getters` keeps the getters of a class, which a plain object of a view holds as data.
 */
export function getDataProperties(
  types: TypeQueries,
  properties: readonly TSSymbol[],
  classType: Type | undefined,
  getters = false,
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
      (!isClassAccessor(p) || (getters && Boolean(p.flags & SymbolFlags.GetAccessor))) &&
      // mapped types keep methods (`DeepPartial<Account>`) and class accessors (`Readonly<C>`)
      // as properties, still functions or on the prototype
      !(
        p.flags & SymbolFlags.Transient &&
        p.declarations.length > 0 &&
        p.declarations.every(
          (d) => MAPPED_METHOD_KINDS.has(d.kind) || (isClassInstance && isAccessorDeclaration(d)),
        )
      ) &&
      // members inherited from a built-in class (`Error#message`, `Readable#readable`) are not own enumerable data
      !(isClassInstance && isBuiltinMember(types, p, isError)),
  )
}

/**
 * Whether a property is a member an instance inherits from a built-in class, which it does not
 * write as own data: declared by the runtime (`Error#message`), or redeclared by an interface
 * over a built-in declaring it (`interface AppError extends Error { message: 'boom' }`), also
 * through other interfaces, unless a class between them declares it (as a field).
 */
export function isBuiltinMember(types: TypeQueries, property: TSSymbol, isError = false): boolean {
  if (isBuiltinSymbol(types, property, isError)) {
    return true
  }

  return types.memo('redeclaredBuiltinMember', property.id, () => {
    const declarations = property.declarations

    if (
      !declarations.length ||
      !declarations.every((d) => d.kind === SyntaxKind.PropertySignature)
    ) {
      return false
    }

    return declarations.some((declaration) => {
      const owner = (declaration.resolve() as any)?.parent
      const symbol =
        owner?.kind === SyntaxKind.InterfaceDeclaration && owner.name
          ? types.checker.getSymbolAtLocation(owner.name)
          : undefined
      const declared = symbol && types.checker.getDeclaredTypeOfSymbol(symbol)
      const target = declared?.isTypeReference() ? declared.getTarget() : declared

      return (target?.getBaseTypes() ?? []).some((base) => {
        const inherited = types.checker.getPropertyOfType(base, property.name)
        return (
          inherited !== undefined &&
          inherited.id !== property.id &&
          isBuiltinMember(types, inherited)
        )
      })
    })
  })
}

/**
 * Whether JSON serialization drops a property of this type: `undefined`, functions,
 * and symbols, optionally mixed with `undefined` (`cb?: () => void`).
 */
export function isDropped(types: TypeQueries, type: Type): boolean {
  const members = type.isUnionType() ? types.getMembers(type) : [type]
  return members.every((m) => m.flags & UNDEFINED_FLAGS || isNonSerializable(types, m))
}

/**
 * Whether JSON serialization drops a value of this type: symbols and functions, unless a function
 * has a `toJSON` (`JSON.stringify` calls it, also of a class constructor's static `toJSON`).
 */
export function isNonSerializable(
  types: TypeQueries,
  type: Type,
  seen: Set<number> = new Set(),
): boolean {
  if (type.flags & TypeFlags.ESSymbolLike) {
    return true
  }

  if (!isFunction(types, type)) {
    return false
  }

  // `toJSON(): this` of a function is a function again
  if (seen.has(type.id)) {
    return true
  }
  seen.add(type.id)

  const result = getToJSONResultType(types, type, true)
  const members = result?.isUnionType() ? types.getMembers(result) : result ? [result] : []

  return members.every((m) => m.flags & UNDEFINED_FLAGS || isNonSerializable(types, m, seen))
}

/**
 * Whether JSON serialization may drop a value of this type: a function whose `toJSON` is optional
 * (`(() => void) & { toJSON?: () => string }`) is written by `toJSON`, or else as nothing.
 */
export function mayBeNonSerializable(types: TypeQueries, type: Type): boolean {
  return (
    (isFunction(types, type) &&
      (isNonSerializable(types, type) || hasOptionalToJSON(types, type))) ||
    isFunctionView(types, type)
  )
}

/**
 * Whether a mapped type may hold the function it is a view of, which JSON drops unless it has a
 * `toJSON` (`Readonly<() => void>`, `cb` of `DeepReadonly<{ cb: () => void }>`, see
 * `getViewedFunction`).
 */
function isFunctionView(types: TypeQueries, type: Type): boolean {
  const viewed = getViewedFunction(types, type)
  return (
    viewed !== undefined &&
    (viewed === type || isNonSerializable(types, viewed) || hasOptionalToJSON(types, viewed))
  )
}

/**
 * The function a mapped type is a view of (`Readonly<FnWithJSON>`), or the mapped type itself when
 * it has no keys, as a mapped type over a function has when its source is not found
 * (`T extends object ? { readonly [K in keyof T]: ... } : T`).
 */
export function getViewedFunction(types: TypeQueries, type: Type): Type | undefined {
  if (!(type.flags & TypeFlags.Object) || !((type as any).objectFlags & ObjectFlags.Mapped)) {
    return undefined
  }

  return types.memo('viewedFunction', type.id, () => {
    const source = types.getMappedSource(type)

    if (source) {
      return isFunction(types, source) ? source : undefined
    }

    return isKeyOfMapping(type) &&
      !(
        type.getAliasSymbol() &&
        type.getAliasTypeArguments().some((a) => a.flags & INSTANTIABLE_FLAGS)
      ) &&
      !types.getProperties(type).length &&
      !types.checker.getIndexInfosOfType(type).length
      ? type
      : undefined
  })
}

/**
 * Whether a mapped type maps each key of a type to a value (`{ [K in keyof T]: ... }`), not
 * to keys of its own (`as`).
 */
function isKeyOfMapping(type: Type): boolean {
  const mapped = type.getSymbol()?.declarations[0]?.resolve() as any
  const constraint = mapped?.typeParameter?.constraint

  return (
    mapped?.kind === SyntaxKind.MappedType &&
    !mapped.nameType &&
    constraint?.kind === SyntaxKind.TypeOperator &&
    constraint.operator === SyntaxKind.KeyOfKeyword
  )
}

/**
 * Functions, also with properties (`{ (): void; displayName: string }`, `(() => void) & { tag }`)
 * or as constructors.
 */
export function isFunction(types: TypeQueries, type: Type): boolean {
  if (type.isIntersectionType()) {
    return types.getMembers(type).some((m) => isFunction(types, m))
  }

  if (
    !(type.flags & TypeFlags.Object) ||
    // object literals have no signatures
    isObjectLiteral(type) ||
    types.getReferenceKind(type) !== undefined
  ) {
    return false
  }

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

  const toJSON = getOwnToJSON(types, type)
  const method = toJSON && types.checker.getTypeOfSymbol(toJSON)

  // `Partial<Money>` maps the method to an optional property, the instance still has it
  const callable =
    method && method.isUnionType()
      ? types.getMembers(method).find((m) => !(m.flags & NULLISH_FLAGS))
      : method

  return getCallReturnType(types.checker, callable)
}

/**
 * The `toJSON` a value of this type calls: of `C & { toJSON: () => R }`
 * (`Object.assign(new C(), { toJSON })`), the own one, which shadows the class's method.
 */
function getOwnToJSON(types: TypeQueries, type: Type): TSSymbol | undefined {
  if (type.isIntersectionType()) {
    const owners = types.getMembers(type).filter((m) => getToJSON(types, m) !== undefined)
    const own = owners.filter((m) => getClassType(types, m) === undefined)

    if (owners.length > 1 && own.length === 1) {
      return getToJSON(types, own[0]!)
    }
  }

  return getToJSON(types, type)
}

/**
 * Whether the `toJSON` of a type may be missing (`toJSON?(): string`, or `Partial<Money>`),
 * so a value is either what `toJSON` returns or its own fields.
 */
export function hasOptionalToJSON(types: TypeQueries, type: Type): boolean {
  const toJSON = getOwnToJSON(types, type)
  const method = toJSON && types.checker.getTypeOfSymbol(toJSON)
  return Boolean(
    toJSON &&
    (toJSON.flags & SymbolFlags.Optional ||
      (method?.isUnionType() && types.getMembers(method).some((m) => m.flags & NULLISH_FLAGS))),
  )
}

/**
 * The class instance type of a type, also through `Readonly<C>`, `Pick<C, K>`, `C & { ... }`,
 * and `this`: the first of `getClassTypes`.
 */
export function getClassType(types: TypeQueries, type: Type): Type | undefined {
  return getClassTypes(types, type)[0]
}

/**
 * The class instance types behind a type, also through `Readonly<C>`, `Pick<C, K>`, `C & { ... }`,
 * and `this`, and every class an interface or intersection is over
 * (`interface L extends Pick<A, 'id'>, Pick<B, 'v'>`), whose instances a value may be.
 */
export function getClassTypes(types: TypeQueries, type: Type): readonly Type[] {
  return types.memo('classTypes', type.id, () => {
    const found = new Map<number, Type>()
    collectClassTypes(types, type, found, new Set())
    return [...found.values()]
  })
}

function collectClassTypes(
  types: TypeQueries,
  type: Type,
  found: Map<number, Type>,
  visited: Set<number>,
): void {
  const symbol = type.getSymbol()

  // each type once, which also ends cycles through heritage clauses, at any nesting depth
  if (visited.has(type.id)) {
    return
  }
  visited.add(type.id)

  if (symbol && (symbol.flags & SymbolFlags.Class || isConstructedInterface(types, type, symbol))) {
    found.set(type.id, type)
    return
  }

  // an interface extending a class describes its instances (and, unless the class has private
  // members, plain objects), also through another interface, a view (`Pick<C, K>`),
  // or an intersection (`C & { x: string }`)
  if (symbol && symbol.flags & SymbolFlags.Interface) {
    const target = type.isTypeReference() ? type.getTarget() : type

    for (const base of target.getBaseTypes() ?? []) {
      collectClassTypes(types, base, found, visited)
    }
    return
  }

  if (type.flags & TypeFlags.TypeParameter) {
    const constraint = types.checker.getBaseConstraintOfType(type)
    if (constraint && constraint.id !== type.id) {
      collectClassTypes(types, constraint, found, visited)
    }
    return
  }

  if (type.isIntersectionType()) {
    for (const member of types.getMembers(type)) {
      collectClassTypes(types, member, found, visited)
    }
    return
  }

  const source = types.getMappedSource(type)
  if (source) {
    collectClassTypes(types, source, found, visited)
  }
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
 * Whether a type is a view of a class (`Readonly<C>`, `Pick<C, K>`, `C & { ... }`), which may
 * hold an instance or a plain object: not the class itself, and not an interface or intersection
 * keeping the private members of a class, which only instances are assignable to
 * (`Readonly<C>` and `Pick<C, K>` drop them).
 */
export function isClassView(types: TypeQueries, type: Type, classType: Type): boolean {
  return classType.id !== type.id && !types.isNominalClass(type)
}

/**
 * Whether types convert differently in another mode than under the serializer: when they reach
 * a `Set`, `Map`, `Blob`, `File`, or `bigint`, a built-in subclass serialized through its own
 * `toJSON`, or an object literal with `toJSON`. Class instances are always converted under
 * `JSON.stringify` rules, so they convert the same way in every mode.
 *
 * - `stringify`: under `JSON.stringify`. A view of a class (`Readonly<C>`) is converted in the
 *   `either` mode under the serializer, so it differs when its fields do, or when an instance
 *   differs from a plain object: `toJSON` (also of the class), getters, or a built-in base.
 * - `either`: when the value may be written by either one. A view is converted in the `either`
 *   mode under the serializer too, so it never differs.
 */
export class ModeSensitivity {
  private readonly cache = new Map<number, boolean>()
  /**
   * Results of the current walk that a cut expansion made not final, by the type and the
   * expansions around it, which decide where it is cut, so each is walked once per walk
   */
  private readonly walked = new Map<string, boolean>()
  /** Types on the current path, with their visit order, and whether they found a sensitive part */
  private readonly onPath = new Map<number, { order: number; sensitive: boolean }>()
  private readonly path: number[] = []
  private order = 0
  /** Infinitely expanding generics are cut, the converter cuts them too */
  private readonly expansion: ExpansionGuard

  constructor(
    private readonly types: TypeQueries,
    private readonly mode: 'stringify' | 'either',
  ) {
    this.expansion = new ExpansionGuard(types)
  }

  isSensitive(type: Type): boolean {
    try {
      return this.visit(type).sensitive
    } finally {
      this.walked.clear()
    }
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

    const walkKey = `${type.id}:${this.expansion.getContext()}`
    const walked = this.walked.get(walkKey)

    if (walked !== undefined) {
      return { sensitive: walked, low: Infinity }
    }

    const current = this.onPath.get(type.id)

    if (current !== undefined) {
      return { sensitive: current.sensitive, low: current.order }
    }

    const entry = { order: this.order++, sensitive: false }
    this.onPath.set(type.id, entry)
    this.path.push(type.id)

    let low = entry.order
    const cuts = this.expansion.cuts
    entry.sensitive =
      this.expansion.expand(type, () =>
        this.compute(type, (child) => {
          const result = this.visit(child)
          low = Math.min(low, result.low)
          return result.sensitive
        }),
      ) ?? false

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

    // a cut hides what the expansion reaches further down, so only a sensitive part found is
    // final: the same type reached from elsewhere (or directly) is walked deeper. In the same
    // expansions, this walk reuses it, which keeps a DAG of types (`{ a: L; b: L }`) linear.
    const final = sensitive || cuts === this.expansion.cuts

    for (const id of members) {
      this.onPath.delete(id)
      if (final) {
        this.cache.set(id, sensitive)
      }
    }

    if (!final) {
      this.walked.set(walkKey, sensitive)
    }

    return { sensitive, low: Infinity }
  }

  private compute(type: Type, isSensitive: (type: Type) => boolean): boolean {
    const types = this.types
    const flags = type.flags

    // `JSON.stringify` throws on a bigint, unless `toJSON` is polyfilled, so the `either` mode
    // differs only through it
    if (flags & TypeFlags.BigIntLike) {
      return this.mode === 'stringify' || hasBigIntToJSON(types)
    }

    // the serializer leaves typed arrays, also with added fields, to `JSON.stringify`, but not
    // the plain object a view of a typed array class may hold (`Pick<class B extends Uint8Array, 's'>`)
    if (flags & (TypeFlags.Object | TypeFlags.Intersection) && isTypedArray(types, type)) {
      const classType = getClassType(types, type)
      if (classType === undefined || !isClassView(types, type, classType)) {
        return false
      }
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

      const classType = getClassType(types, type)

      // a class instance is converted the same way either way, a view (`C & { ... }`)
      // may also hold a plain object
      if (classType !== undefined) {
        // `MyMap & { x: string }` is written as a map or by `JSON.stringify`
        return (
          isModeSensitiveBuiltin(types, classType) ||
          (isClassView(types, type, classType) && this.computeView(type, classType, isSensitive))
        )
      }

      return members.some(isSensitive)
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

    // a built-in the serializer or `JSON.stringify` handles, not a library interface
    // holding data (`PromiseFulfilledResult<T>`)
    if (
      getDeclaredBuiltinName(types, type) !== undefined &&
      (getBuiltin(types, type, false) ?? getBuiltin(types, type, true)) !== undefined
    ) {
      // the serializer converts a boxed `BigInt` in the `either` mode already
      return (
        isModeSensitiveBuiltin(types, type) &&
        !(this.mode === 'either' && isBoxedBigInt(types, type))
      )
    }

    const symbol = type.getSymbol()
    const classType = getClassType(types, type)
    // the class, or an interface extending a built-in (`interface Tags extends Set<string>`)
    const declared =
      classType ?? (symbol && symbol.flags & SymbolFlags.Interface ? type : undefined)
    const extended = declared && getBuiltinBaseName(types, declared)

    // the serializer converts a view in the `either` mode, also an interface extending a built-in
    // class (`interface AppError extends Error`), unless it is a built-in
    // (`Readonly<class Tags extends Set<string>>`)
    if (
      this.mode === 'either' &&
      (classType !== undefined
        ? isClassView(types, type, classType)
        : extendsBuiltinClass(types, type)) &&
      getBuiltin(types, type, false) === undefined &&
      getBuiltin(types, type, true) === undefined
    ) {
      return false
    }

    // also an interface extending a view of a built-in (`interface Sized extends Pick<Set<T>, 'size'>`)
    if (declared !== undefined && isModeSensitiveBuiltin(types, declared)) {
      return true
    }

    if (extended !== undefined) {
      // `class Rows extends Array<Set<string>>` is an array of its items
      if (extended === 'Array' || extended === 'ReadonlyArray') {
        const item = types.checker
          .getIndexInfosOfType(type)
          .find((info) => info.keyType.flags & TypeFlags.Number)?.valueType
        return item !== undefined && isSensitive(item)
      }
    }

    // class instances are converted under `JSON.stringify` rules either way, views may also
    // hold plain objects
    if (classType !== undefined) {
      return isClassView(types, type, classType) && this.computeView(type, classType, isSensitive)
    }

    // a view of a built-in (`Pick<Set<string>, 'size'>`), also when it keeps too few members
    // to tell the built-in by them
    if (
      (type as any).objectFlags & ObjectFlags.Mapped &&
      (getBuiltin(types, type, false) ?? getBuiltin(types, type, true)) !== undefined
    ) {
      return isModeSensitiveBuiltin(types, type)
    }

    const properties = types.getProperties(type)
    const hasToJSON = properties.some((p) => p.name === 'toJSON')

    // the serializer skips `toJSON` of plain objects, `JSON.stringify` calls it. An object literal
    // is a plain object, a declared object type (`interface Point { toJSON(): string }`) may be
    // one, so the serializer writes what `toJSON` returns or its fields, the `either` mode too.
    if (hasToJSON) {
      return (
        this.mode === 'stringify' ||
        isObjectLiteral(type) ||
        this.computeFields(type, isSensitive, false)
      )
    }

    return this.computeFields(type, isSensitive)
  }

  /**
   * Whether a view of a class converts differently: never between the serializer and the
   * `either` mode (the serializer converts it in that mode), and under `JSON.stringify`, which
   * converts it as an instance, when a plain object differs from an instance (`toJSON` of the
   * view or of its class, getters, members inherited from a built-in, a built-in base), or its
   * fields do.
   */
  private computeView(type: Type, classType: Type, isSensitive: (type: Type) => boolean): boolean {
    const types = this.types

    if (this.mode === 'either') {
      return false
    }

    if (
      getClassTypes(types, type).some(
        (c) =>
          getToJSON(types, c) ||
          getBuiltin(types, c, false) !== undefined ||
          getBuiltin(types, c, true) !== undefined,
      )
    ) {
      return true
    }

    const properties = types.getProperties(type)

    return (
      getDataProperties(types, properties, undefined, true).length !==
        getDataProperties(types, properties, classType).length ||
      this.computeFields(type, isSensitive)
    )
  }

  /**
   * Whether the fields of a type convert differently, or (with `toJSON`) it has `toJSON`.
   */
  private computeFields(type: Type, isSensitive: (type: Type) => boolean, toJSON = true): boolean {
    const types = this.types
    const properties = types.getProperties(type)

    if (toJSON && properties.some((p) => p.name === 'toJSON')) {
      return true
    }

    const data = properties.filter((p) => !(p.flags & (SymbolFlags.Method | SymbolFlags.Prototype)))
    const dataTypes = types.getSymbolTypes(data)

    return (
      dataTypes.some((t) => t !== undefined && isSensitive(t)) ||
      types.checker.getIndexInfosOfType(type).some((info) => isSensitive(info.valueType))
    )
  }
}
