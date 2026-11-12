import { SyntaxKind } from 'typescript/unstable/ast'
import type { Signature, Symbol as TSSymbol, Type } from 'typescript/unstable/sync'
import { ObjectFlags, SignatureKind, SymbolFlags, TypeFlags } from 'typescript/unstable/sync'

import {
  extendsBuiltinClass,
  extendsError,
  getBaseTypes,
  getBuiltin,
  getBuiltinBaseName,
  getIndexInfos,
  getPropertyNames,
  getToJSON,
  getViewBases,
  isBuiltinSymbol,
} from './builtins'
import type { TypeQueries } from './type-queries'
import { INSTANTIABLE_FLAGS, isObjectLiteral, UNDEFINED_FLAGS } from './type-queries'
import { isClassAccessor } from './utils'

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
  // (also of an interface extending a view of `Error`, `interface AppError extends Readonly<Error>`)
  const isError = isClassInstance && extendsError(types, classType)

  return properties.filter(
    (p) =>
      !(p.flags & (SymbolFlags.Method | SymbolFlags.Prototype)) &&
      // symbol keys (`__@iterator@12`) and #private fields (`__#12@#secret`);
      // quoted keys starting with `__` are escaped with another `_`
      !p.escapedName.startsWith('__@') &&
      !p.escapedName.startsWith('__#') &&
      !isLibraryKey(types, p) &&
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
 * Whether a property is a key of a package that no value holds as data: the key ArkType brands
 * a type with (`' brand'` of `Brand<T, 'Id'>`, which `.brand('Id')` and `'string#Id'` give), and
 * Effect's keys, which stand for symbols: its brand (`'~effect/Brand'` of `Brand.Brand<'Id'>`),
 * the type ids of its prototypes (`'~effect/Option'`), and what it adds to `Error`.
 */
function isLibraryKey(types: TypeQueries, property: TSSymbol): boolean {
  return (
    (property.name === ' brand' || property.name.startsWith('~effect/')) &&
    isDeclaredByPackage(types, property)
  )
}

function isDeclaredByPackage(types: TypeQueries, property: TSSymbol): boolean {
  return (
    property.declarations.length > 0 &&
    property.declarations.every((d) => types.getSourceKind(d.path) === 'external')
  )
}

/**
 * Whether a type is of an Effect data type (`Option`, `Redacted`, `Chunk`), holding the type id
 * its interface requires (`'~effect/Option'`), also in a partial view: its values are made from
 * a prototype with the `toJSON` of `Inspectable`, which `JSON.stringify` writes, as any value,
 * also where the interface does not declare it (`Redacted`). Brands are only in types, and the
 * methods of `Equal` and `Hash` are dropped from plain objects (`{ id: string } & Hash.Hash`).
 */
export function isEffectValue(types: TypeQueries, type: Type): boolean {
  return types.memo('effectValue', type.id, () => {
    const ids = types.getProperties(type).filter(
      (p) =>
        p.name.startsWith('~effect/') &&
        p.name !== '~effect/Brand' &&
        isDeclaredByPackage(types, p) &&
        // declared required, not as a method: markers (`'~effect/Runtime/errorReported'` of
        // `Error`) are optional, `'~effect/Hash'` is a method
        p.declarations.every(
          (d) =>
            d.kind === SyntaxKind.PropertySignature &&
            (d.resolve() as any)?.postfixToken?.kind !== SyntaxKind.QuestionToken,
        ),
    )

    return (
      ids.length > 0 &&
      types
        .getSymbolTypes(ids)
        .some(
          (t) =>
            t !== undefined &&
            types
              .getUnionMembers(t)
              .some((m) => !(m.flags & UNDEFINED_FLAGS) && !isFunction(types, m)),
        )
    )
  })
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

      return (declared ? getBaseTypes(types, declared) : []).some((base) => {
        const inherited = types.getProperty(base, property.name)
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
  return types
    .getUnionMembers(type)
    .every((m) => m.flags & UNDEFINED_FLAGS || isNonSerializable(types, m))
}

/**
 * Whether JSON serialization drops a value of this type: symbols (also branded,
 * `symbol & { __brand: 'Id' }`) and functions, unless a function has a `toJSON` (`JSON.stringify`
 * calls it, also of a class constructor's static `toJSON`) returning a value it writes.
 */
export function isNonSerializable(types: TypeQueries, type: Type): boolean {
  return (
    isSymbol(types, type) ||
    (isFunction(types, type) && !getWrittenToJSONResultTypes(types, type).length)
  )
}

/**
 * Whether a type is a symbol, also a branded one (`symbol & { __brand: 'Id' }`).
 */
function isSymbol(types: TypeQueries, type: Type): boolean {
  return Boolean(
    type.flags & TypeFlags.ESSymbolLike ||
    (type.isIntersectionType() &&
      types.getMembers(type).some((m) => m.flags & TypeFlags.ESSymbolLike)),
  )
}

/**
 * Whether `JSON.stringify` writes nothing for what a `toJSON` returns: `undefined`, a symbol, or a
 * function, also one with a `toJSON`, which it does not call on a returned value
 * (`toJSON(): (() => void) & { toJSON(): string }`, `toJSON(): this` of a function).
 */
export function isDroppedResult(types: TypeQueries, type: Type): boolean {
  return types
    .getUnionMembers(type)
    .every((m) => m.flags & UNDEFINED_FLAGS || isFunction(types, m) || isSymbol(types, m))
}

/**
 * Whether JSON serialization may drop a value of this type: a function whose `toJSON` is optional
 * (`(() => void) & { toJSON?: () => string }`) is written by `toJSON`, or else as nothing,
 * a type a function is assignable to (`object`, `{}`, `Object`), and a view of a symbol.
 */
export function mayBeNonSerializable(types: TypeQueries, type: Type): boolean {
  return (
    (isFunction(types, type) &&
      (isNonSerializable(types, type) || hasOptionalToJSON(types, type))) ||
    isFunctionView(types, type) ||
    mayHoldFunction(types, type) ||
    mayHoldSymbol(types, type)
  )
}

/**
 * Whether a value of this type may be a symbol: a view of one, or of the `Symbol` interface
 * (`Omit<symbol, 'k'>`, `Readonly<SymbolId>` of `SymbolId = symbol & { __brand: 'Id' }`), also in
 * an intersection, or through a conditional mapped type.
 */
function mayHoldSymbol(types: TypeQueries, type: Type, visited: Set<number> = new Set()): boolean {
  if (visited.has(type.id)) {
    return false
  }
  visited.add(type.id)

  if (type.flags & TypeFlags.ESSymbolLike) {
    return true
  }

  if (type.isIntersectionType()) {
    return types.getMembers(type).some((m) => mayHoldSymbol(types, m, visited))
  }

  const source = types.getMappedSource(type)
  if (source) {
    return mayHoldSymbol(types, source, visited)
  }

  // the members a conditional mapped type maps over (`DeepReadonly<symbol & { __brand: 'Id' }>`)
  if (
    [...types.getMappedSourceMembers(type), ...types.getBrandedOwners(type)].some((m) =>
      mayHoldSymbol(types, m, visited),
    )
  ) {
    return true
  }

  const symbol = type.getSymbol()
  return symbol?.name === 'Symbol' && types.getSymbolSourceKind(symbol) === 'default'
}

/**
 * Whether a function is assignable to a type that is no function: `object`, `Object`, the empty
 * object type `{}`, also as a mapped type without keys (`Omit<{ a: number }, 'a'>`, also of a
 * class: `Pick<User, never>`), unless it is a view of a function (see `isFunctionView`),
 * `Record<string, any>`, and an intersection of one with optional properties.
 */
function mayHoldFunction(types: TypeQueries, type: Type): boolean {
  if (type.flags & TypeFlags.NonPrimitive) {
    return true
  }

  if (type.isIntersectionType()) {
    return isLooseIntersection(types, types.getMembers(type))
  }

  if (
    !(type.flags & TypeFlags.Object) ||
    isObjectLiteral(type) ||
    ((type as any).objectFlags & ObjectFlags.Mapped &&
      (getViewedFunction(types, type) !== undefined ||
        type.getAliasTypeArguments().some((a) => a.flags & INSTANTIABLE_FLAGS)))
  ) {
    return false
  }

  const symbol = type.getSymbol()
  if (symbol?.name === 'Object' && types.getSymbolSourceKind(symbol) === 'default') {
    return true
  }

  return (
    !types.getProperties(type).length &&
    (!getIndexInfos(types, type).length || isAnyRecord(types, type)) &&
    !types.isCallable(type) &&
    mayBePlainObject(types, type)
  )
}

/**
 * Whether an intersection of these members holds what a member holding any value does (`object`,
 * `{}`, `Pick<User, never>`): its other members have only optional properties
 * (`object & { extra?: string }`), which an array, a date, or a function satisfies too.
 */
export function isLooseIntersection(types: TypeQueries, members: readonly Type[]): boolean {
  const loose = members.filter((m) => mayHoldFunction(types, m))

  return (
    loose.length > 0 &&
    members.every(
      (m) =>
        loose.includes(m) ||
        (m.flags & TypeFlags.Object &&
          !types.isCallable(m) &&
          !getIndexInfos(types, m).length &&
          types.getProperties(m).every((p) => p.flags & SymbolFlags.Optional)),
    )
  )
}

/**
 * Whether a type is only a string index signature of `any` (`Record<string, any>`, `Readonly<any>`),
 * which, like `object`, every object type is assignable to: arrays, dates, and functions too. Not
 * one of an unresolved name (`Record<string, Missing>`), whose error type is `any` to the compiler.
 */
export function isAnyRecord(types: TypeQueries, type: Type): boolean {
  if (!(type.flags & TypeFlags.Object) || types.getProperties(type).length) {
    return false
  }

  const infos = getIndexInfos(types, type)
  return (
    infos.length > 0 &&
    infos.every(
      (info) =>
        info.keyType.flags & TypeFlags.String &&
        info.valueType.flags & TypeFlags.Any &&
        !info.valueType.isErrorType(),
    )
  )
}

/**
 * Whether a mapped type may hold the function it is a view of, which JSON drops unless it has a
 * `toJSON` (`Readonly<() => void>`, `cb` of `DeepReadonly<{ cb: () => void }>`, see
 * `getViewedFunction`), and so may an interface over one whose `toJSON` may be missing
 * (`interface V extends Readonly<Function> { toJSON?(): string }`), also through views of it
 * (`Readonly<V>`, `Readonly<Readonly<V>>`).
 */
function isFunctionView(types: TypeQueries, type: Type): boolean {
  if (isInterfaceOverFunctionView(types, type)) {
    return !getWrittenToJSONResultTypes(types, type).length || hasOptionalToJSON(types, type)
  }

  const viewed = getViewedFunction(types, type)
  return (
    viewed !== undefined &&
    // a mapped type without keys stands in for a function without fields
    (!isFunction(types, viewed) ||
      isNonSerializable(types, viewed) ||
      hasOptionalToJSON(types, viewed))
  )
}

/**
 * Whether a type is an interface over a view of a function
 * (`interface V extends Readonly<Function> {}`), or a view of one (`Readonly<V>`).
 */
function isInterfaceOverFunctionView(types: TypeQueries, type: Type): boolean {
  const source = types.getMappedSource(type) ?? type
  return getViewBases(types, source).some((view) => getViewedFunction(types, view) !== undefined)
}

/**
 * The function a mapped type is a view of (`Readonly<FnWithJSON>`), or the mapped type without keys
 * a mapped type over a function is when its source is not found
 * (`T extends object ? { readonly [K in keyof T]: ... } : T`), also through views of it
 * (`Readonly<DeepReadonly<() => void>>`).
 */
export function getViewedFunction(types: TypeQueries, type: Type): Type | undefined {
  if (!(type.flags & TypeFlags.Object) || !((type as any).objectFlags & ObjectFlags.Mapped)) {
    return undefined
  }

  return types.memo('viewedFunction', type.id, () => {
    const source = types.getMappedSource(type)

    if (source) {
      return isFunction(types, source) ? source : getViewedFunction(types, source)
    }

    return isKeyOfMapping(type) &&
      !(
        type.getAliasSymbol() &&
        type.getAliasTypeArguments().some((a) => a.flags & INSTANTIABLE_FLAGS)
      ) &&
      !types.getProperties(type).length &&
      !getIndexInfos(types, type).length
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

/** The library interfaces of functions, which interfaces may extend */
const FUNCTION_INTERFACES: ReadonlySet<string> = new Set([
  'Function',
  'CallableFunction',
  'NewableFunction',
])

/**
 * Functions, also with properties (`{ (): void; displayName: string }`, `(() => void) & { tag }`),
 * as constructors, or as interfaces extending `Function` (`CallableFunction`,
 * `interface Handler extends Function { meta: string }`, also through `CallableFunction`).
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
  if (
    (symbol?.name === 'Function' && types.getSymbolSourceKind(symbol) === 'default') ||
    FUNCTION_INTERFACES.has(getBuiltinBaseName(types, type) ?? '')
  ) {
    return true
  }

  return types.isCallable(type)
}

/**
 * What `toJSON` of a value of this type may return, when it is called during serialization,
 * empty when it is not: one type per function it may be (`(() => A) | (() => B)`).
 * The serializer walks plain objects key by key, `JSON.stringify` calls their `toJSON` too.
 */
export function getToJSONResultTypes(
  types: TypeQueries,
  type: Type,
  stringify: boolean,
): readonly Type[] {
  if (!(type.flags & (TypeFlags.Object | TypeFlags.Intersection))) {
    return []
  }

  return types.memo(stringify ? 'stringifiedToJSON' : 'serializedToJSON', type.id, () => {
    // a view of the method whose function is found nowhere (`{}` of
    // `DeepReadonly<(() => number) & { toJSON(): string }>`, not over a class or a built-in,
    // whose `toJSON` is read instead) may be called on the function or instance it keeps no trace
    // of, and return anything
    let unknownMethod: boolean | undefined
    const hasUnknownMethod = () =>
      (unknownMethod ??=
        // of the properties the type is converted by, read once
        types.getProperties(type).some((p) => p.name === 'toJSON') &&
        getToJSONMembers(types, type).some((m) => getViewedFunction(types, m)?.id === m.id) &&
        getClassType(types, type) === undefined &&
        getBuiltin(types, type, stringify) === undefined)

    // the serializer walks arrays and plain objects, also with a brand
    // (`string[] & { toJSON(): undefined }`), `JSON.stringify` calls their `toJSON`
    if (!stringify) {
      const members = type.isIntersectionType() ? types.getMembers(type) : [type]

      if (
        (members.some((m) => types.getReferenceKind(m) !== undefined) ||
          members.every((m) => !(m.flags & TypeFlags.Object) || isObjectLiteral(m))) &&
        !hasUnknownMethod()
      ) {
        return []
      }
    }

    // `Partial<Money>` maps the method to an optional property, the instance still has it, and
    // `OrFrozen<Money>` to the method or a view of it (`(() => R) | Readonly<() => R>`)
    const results = new Map<number, Type>()

    for (const member of getToJSONMembers(types, type)) {
      for (const result of getMethodResultTypes(types, member, type)) {
        results.set(result.id, result)
      }
    }

    return results.size || !hasUnknownMethod()
      ? [...results.values()]
      : [types.checker.getAnyType()]
  })
}

/**
 * What `toJSON` of a value of this type may return that `JSON.stringify` writes, when it calls
 * it: not `undefined`, a symbol, or a function (see `isDroppedResult`).
 */
export function getWrittenToJSONResultTypes(types: TypeQueries, type: Type): readonly Type[] {
  return getToJSONResultTypes(types, type, true).filter((result) => !isDroppedResult(types, result))
}

/**
 * The members of the type of the `toJSON` a value of this type calls.
 */
function getToJSONMembers(types: TypeQueries, type: Type): readonly Type[] {
  const toJSON = getOwnToJSON(types, type)
  const [method] = toJSON ? types.getSymbolTypes([toJSON]) : []
  return method ? types.getUnionMembers(method) : []
}

/**
 * What a function returns when `JSON.stringify` calls it on a value of `owner`, with the key: of
 * the overload this call resolves to, and of the one a call without arguments resolves to (an
 * implementation may ignore the key, `toJSON(options?)`), else of each overload, leaving out those
 * whose `this` the value does not satisfy. Of each function of an intersection (`Date & { toJSON(): number }`, of
 * `Object.assign`), and of the function a view of one may hold (`Readonly<() => R>`), or anything
 * (`Function`, and `any`, `unknown`, `object`, `{}`, or `Object`, which may hold one).
 */
function getMethodResultTypes(types: TypeQueries, member: Type, owner: Type): readonly Type[] {
  const functions = getMethodOverloads(types, member)

  if (!functions) {
    return [types.checker.getAnyType()]
  }

  return functions.flatMap((overloads) => {
    const callable = overloads.filter((o) => satisfiesThis(types, owner, o))
    // of a key some strings are (`toJSON(key: '')`, which the root's `''` calls), up to the first
    // overload of any key
    const all = callable.findIndex((o) => o.withKey === 'all')
    const withKey = callable.filter((o, i) => o.withKey && (all < 0 || i <= all))
    const withoutArguments = callable.find((o) => o.withoutArguments)
    const called = callable.filter((o) => withKey.includes(o) || o === withoutArguments)

    return (called.length ? called : callable.length ? callable : overloads).flatMap(
      (o) => o.results,
    )
  })
}

/**
 * Whether a value of `owner` may call an overload, by its `this`. The compiler infers the type
 * parameters of a generic one from the value (`this: Marker<P>`), so it may when the value has
 * the properties of `this` (a document type carrying the marker).
 */
function satisfiesThis(types: TypeQueries, owner: Type, overload: MethodOverload): boolean {
  const { thisType } = overload

  if (thisType === undefined) {
    return true
  }

  if (!overload.generic) {
    return types.checker.isTypeAssignableTo(owner, thisType)
  }

  const names = getPropertyNames(types, owner)
  return types.getProperties(thisType).every((p) => names.has(p.name))
}

interface MethodOverload {
  results: readonly Type[]
  /** The type `this` must satisfy */
  thisType: Type | undefined
  /** Whether it has type parameters */
  generic: boolean
  /** Whether a call with the key may resolve to it, of any key or only of some (`key: ''`) */
  withKey: 'all' | 'some' | undefined
  /** Whether a call without arguments may resolve to it */
  withoutArguments: boolean
}

/**
 * The overloads of a function, of each function of an intersection, nothing for any function.
 */
function getMethodOverloads(
  types: TypeQueries,
  member: Type,
): readonly MethodOverload[][] | undefined {
  return types.memo('methodOverloads', member.id, () => {
    const { checker } = types

    if (member.flags & (TypeFlags.Any | TypeFlags.Unknown) || mayHoldFunction(types, member)) {
      return undefined
    }

    const method = getViewedFunction(types, member) ?? member
    const functions = method.isIntersectionType() ? types.getMembers(method) : [method]
    const accepts = (signature: Signature, index: number, argument: Type) => {
      const type = checker.getParameterType(signature, index)
      const constraint = type && (checker.getBaseConstraintOfType(type) ?? type)
      return constraint === undefined || checker.isTypeAssignableTo(argument, constraint)
    }

    // the keys an overload takes, of a key `JSON.stringify` passes
    const getKeys = (signature: Signature) => {
      const string = checker.getStringType()
      if (accepts(signature, 0, string)) {
        return 'all'
      }

      const type = checker.getParameterType(signature, 0)
      const constraint = type && (checker.getBaseConstraintOfType(type) ?? type)
      return constraint && checker.isTypeAssignableTo(constraint, string) ? 'some' : undefined
    }

    const overloads = functions
      .map((f) =>
        checker.getSignaturesOfType(f, SignatureKind.Call).map((signature): MethodOverload => {
          const thisParameter = signature.getThisParameter()
          const count = signature.getParameters().length
          // a parameter accepting `undefined` may be left out, and so may a rest parameter
          const optionalFrom = (start: number) =>
            Array.from({ length: count - start }, (_, i) => start + i).every(
              (i) =>
                (signature.hasRestParameter && i === count - 1) ||
                accepts(signature, i, checker.getUndefinedType()),
            )

          types.addUninferredTypeParameters(signature)

          return {
            results: [checker.getReturnTypeOfSignature(signature) ?? []].flat(),
            thisType: thisParameter && types.getSymbolTypes([thisParameter])[0],
            generic: signature.getTypeParameters().length > 0,
            withKey: !count || !optionalFrom(1) ? undefined : getKeys(signature),
            withoutArguments: optionalFrom(0),
          }
        }),
      )
      .filter((o) => o.length)

    return overloads.length || !isFunction(types, method) ? overloads : undefined
  })
}

/**
 * The `toJSON` a value of this type calls: of `C & { toJSON: () => R }`
 * (`Object.assign(new C(), { toJSON })`), the own one, which shadows the class's method, unless
 * it may be missing (`C & { toJSON?: () => R }`), as the class's one is called then.
 */
function getOwnToJSON(types: TypeQueries, type: Type): TSSymbol | undefined {
  if (type.isIntersectionType()) {
    const owners = types.getMembers(type).filter((m) => getToJSON(types, m) !== undefined)
    const own = owners.filter((m) => getClassType(types, m) === undefined)
    const toJSON = owners.length > 1 && own.length === 1 ? getToJSON(types, own[0]!) : undefined

    if (toJSON && !(toJSON.flags & SymbolFlags.Optional)) {
      return toJSON
    }
  }

  return getToJSON(types, type)
}

/**
 * Whether the `toJSON` of a type may be missing (`toJSON?(): string`, or `Partial<Money>`), or
 * may be a value `JSON.stringify` does not call (`toJSON: string | (() => R)`), so a value is
 * either what `toJSON` returns or its own fields. A view of the method
 * (`Readonly<() => R>`) may hold any value, not only the method.
 */
export function hasOptionalToJSON(types: TypeQueries, type: Type): boolean {
  const toJSON = getOwnToJSON(types, type)
  return Boolean(
    toJSON &&
    (toJSON.flags & SymbolFlags.Optional ||
      getToJSONMembers(types, type).some((m) => !isFunction(types, m))),
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
    for (const base of getBaseTypes(types, type)) {
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

  for (const source of types.getMappedSourceMembers(type)) {
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

  return getBaseTypes(types, type).some(next)
}

/**
 * Whether a type is a view of a class (`Readonly<C>`, `Pick<C, K>`, `C & { ... }`), which may
 * hold an instance or a plain object: not the class itself, and not an interface or intersection
 * keeping the private members of a class, which only instances are assignable to
 * (`Readonly<C>` and `Pick<C, K>` drop them).
 */
export function isClassView(types: TypeQueries, type: Type): boolean {
  const classType = getClassType(types, type)
  return (
    classType !== undefined &&
    classType.id !== type.id &&
    !types.isNominalClass(type) &&
    !isWrittenByClassToJSON(types, type)
  )
}

/**
 * Whether a type is an intersection with a class whose `toJSON` it calls (`Doc & T`, a document
 * type), whose values are instances written by it: a plain object would hold a copy of the class's
 * method, which the serializer leaves out. One another member adds a `toJSON` to
 * (`Object.assign(new Doc(), { toJSON })`) may be a plain object holding it.
 */
function isWrittenByClassToJSON(types: TypeQueries, type: Type): boolean {
  if (!type.isIntersectionType()) {
    return false
  }

  const toJSON = getOwnToJSON(types, type)
  const declarations = !toJSON || toJSON.flags & SymbolFlags.Optional ? [] : toJSON.declarations

  return (
    declarations.length > 0 &&
    types.getMembers(type).some((m) => {
      const own = (m.getSymbol()?.flags ?? 0) & SymbolFlags.Class ? getToJSON(types, m) : undefined
      return declarations.every((d) =>
        own?.declarations.some((o) => o.path === d.path && o.index === d.index),
      )
    })
  )
}

/**
 * Whether a value of this type may be a plain object the serializer walks: no class instance,
 * or a view of a class (see `isClassView`).
 */
export function mayBePlainObject(types: TypeQueries, type: Type): boolean {
  return getClassType(types, type) === undefined || isClassView(types, type)
}

/**
 * Whether a value of this type may be an instance or a plain object: a view of a class (see
 * `isClassView`), or an interface extending a built-in class (`interface AppError extends Error`).
 */
export function isInstanceOrPlain(types: TypeQueries, type: Type): boolean {
  return getClassType(types, type) !== undefined
    ? isClassView(types, type)
    : extendsBuiltinClass(types, type)
}
