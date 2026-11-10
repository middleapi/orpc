import type { JsonSchema } from '@orpc/json-schema'
import { stringifyJSON } from '@orpc/shared'
import type { Symbol as TSSymbol, Type } from 'typescript/unstable/sync'
import { ObjectFlags, SymbolFlags, TypeFlags } from 'typescript/unstable/sync'

import { bigintSchema, getLeafBuiltinSchema } from './schema-utils'
import type { TypeQueries } from './type-queries'
import { getIteratorTypes } from './utils'

const TYPED_ARRAYS = new Set([
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float16Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
])

/** Members that identify a built-in through a mapped type over it, most specific first */
const MAPPED_BUILTIN_FINGERPRINTS: readonly (readonly [string, readonly string[]])[] = [
  ['Date', ['getTime', 'toISOString', 'getTimezoneOffset']],
  ['URL', ['href', 'origin', 'searchParams']],
  ['File', ['name', 'lastModified', 'arrayBuffer', 'slice']],
  ['Blob', ['size', 'arrayBuffer', 'slice', 'stream']],
  ['Map', ['get', 'set', 'has', 'delete', 'size']],
  ['Set', ['add', 'has', 'delete', 'size']],
  ['ReadonlyMap', ['get', 'has', 'size', 'forEach']],
  ['ReadonlySet', ['has', 'size', 'forEach']],
]

/** Typings of runtime built-in modules, whose classes are not data holders */
const RUNTIME_TYPINGS = /\/node_modules\/(?:@types\/(?:node|bun|deno)|bun-types|undici-types)\//u

/**
 * How a built-in value is serialized: as a final schema, or as an array, `Set`, or `Map`
 * of element types still to convert.
 */
export type Builtin =
  | { kind: 'schema'; schema: JsonSchema }
  | { kind: 'array'; items: Type | undefined }
  /** Items of these types */
  | { kind: 'set'; items: readonly Type[] }
  /** Entries as `[key, value]` tuples */
  | { kind: 'map'; key: Type | undefined; value: Type | undefined }
  /** Entries of these types, like the iterated `[string, number]` of a `Map` subclass */
  | { kind: 'map-entries'; entries: readonly Type[] }
  /** Index keys of items of this type, which `JSON.stringify` writes (a `bigint` it can not) */
  | { kind: 'typed-array'; items: Type | undefined }

/**
 * The built-in a value of this type is, like `Date`, `Set<T>`, a typed array, a subclass
 * of one, or a mapped type over one (`Readonly<Date>`). `stringify` applies the rules of
 * `JSON.stringify`, which writes `Set`, `Map`, and binary values as `{}`.
 */
export function getBuiltin(
  types: TypeQueries,
  type: Type,
  stringify: boolean,
): Builtin | undefined {
  if ((type as any).objectFlags & ObjectFlags.Mapped) {
    return getMappedBuiltin(types, type, stringify)
  }

  const symbol = type.getSymbol()

  if (!symbol) {
    return undefined
  }

  // only globals of the default library, a `File` or `Map` class of a package is its own type
  if (types.getSymbolSourceKind(symbol) !== 'default') {
    // `Blob`, `File`, and `URL` without the DOM library come from the runtime's typings
    const runtimeGlobal = isBuiltinSymbol(types, symbol)
      ? getLeaf(symbol.name, stringify)
      : undefined

    // `JSON.stringify` calls the own `toJSON` of a built-in subclass, the serializer does not
    return (
      runtimeGlobal ??
      // classes extending built-ins, and interfaces describing them (`interface Tags extends Set<string>`)
      (symbol.flags & (SymbolFlags.Class | SymbolFlags.Interface) &&
      !(stringify && hasOwnToJSON(types, type))
        ? getBuiltinSubclass(types, type, stringify)
        : undefined)
    )
  }

  // `JSON.stringify` calls a `toJSON` a project adds to a built-in (`interface Map<K, V> { toJSON(): ... }`)
  if (stringify && hasOwnToJSON(types, type)) {
    return undefined
  }

  const leaf = getLeaf(symbol.name, stringify)
  if (leaf) {
    return leaf
  }

  if (TYPED_ARRAYS.has(symbol.name)) {
    // serialized like an object with index keys, `{ "0": 1, "1": 2 }`
    return { kind: 'typed-array', items: getNumberIndexType(types, type) }
  }

  const [first, second] = types.getReferenceArguments(type)

  switch (symbol.name) {
    case 'Set':
    case 'ReadonlySet':
      return stringify ? emptyObject() : { kind: 'set', items: first ? [first] : [] }
    case 'Map':
    case 'ReadonlyMap':
      return stringify ? emptyObject() : { kind: 'map', key: first, value: second }
    case 'Promise':
    case 'PromiseLike':
      // only the converted value itself is awaited, a nested promise is serialized as `{}`
      return emptyObject()
    case 'RegExp':
    case 'Function':
    case 'Object':
      return { kind: 'schema', schema: {} }
    case 'Error':
    case 'ArrayBuffer':
    case 'SharedArrayBuffer':
    case 'DataView':
      // no own enumerable data
      return emptyObject()
  }

  return undefined
}

/**
 * Whether the serializer or `JSON.stringify` writes a value of this type as a built-in.
 */
export function hasBuiltinForm(types: TypeQueries, type: Type): boolean {
  return getBuiltin(types, type, false) !== undefined || getBuiltin(types, type, true) !== undefined
}

/**
 * Whether the serializer and `JSON.stringify` write a built-in differently, like `Set`, `Map`,
 * `Blob`, or a built-in subclass with its own `toJSON`, which only `JSON.stringify` calls.
 */
export function isModeSensitiveBuiltin(types: TypeQueries, type: Type): boolean {
  const serialized = getBuiltin(types, type, false)
  const stringified = getBuiltin(types, type, true)

  return serialized?.kind === 'schema' && stringified?.kind === 'schema'
    ? stringifyJSON(serialized.schema) !== stringifyJSON(stringified.schema)
    : serialized?.kind !== stringified?.kind
}

/** Binary values, written by their own keys: typed arrays by index, the others as `{}` */
const BINARY = new Set([...TYPED_ARRAYS, 'ArrayBuffer', 'SharedArrayBuffer', 'DataView'])

/**
 * Whether values of this type are typed arrays, also a subclass (Node's `Buffer`,
 * `class Bytes extends Uint8Array`) or through a mapped type (`Readonly<Uint8Array>`).
 * Unless `toJSON` is called, they are written by their index keys.
 */
export function isTypedArray(types: TypeQueries, type: Type): boolean {
  const kind = getTypedArrayKind(types, type)
  return kind !== undefined && (kind === true || kind.length > 0)
}

/**
 * The views of typed arrays a type is a typed array through: an interface extending one
 * (`interface Sized extends Pick<Uint8Array, 'length'>`), also behind a view, whose values may
 * also be plain objects written by their fields. Empty for other typed arrays.
 */
export function getTypedArrayViewBases(types: TypeQueries, type: Type): readonly Type[] {
  const kind = getTypedArrayKind(types, type)
  return Array.isArray(kind) ? kind : []
}

/**
 * `true` for a typed array, the views of typed arrays it extends for an interface over them.
 */
function getTypedArrayKind(types: TypeQueries, type: Type): true | Type[] | undefined {
  const members = type.isIntersectionType()
    ? types.getMembers(type)
    : (type as any).objectFlags & ObjectFlags.Mapped
      ? types.getMappedSourceMembers(type)
      : [type]

  // `Uint8Array & { label: string }`, `Readonly<Uint8Array & { label: string }>`
  if (type.isIntersectionType() || members.length !== 1) {
    const kinds = members.map((member) => getTypedArrayKind(types, member))
    return kinds.includes(true) ? true : kinds.flatMap((kind) => (Array.isArray(kind) ? kind : []))
  }

  const source = members[0]

  const symbol = source?.getSymbol()

  if (!symbol) {
    return undefined
  }

  if (TYPED_ARRAYS.has(symbol.name) && isBuiltinSymbol(types, symbol)) {
    return true
  }

  const base =
    symbol.flags & (SymbolFlags.Class | SymbolFlags.Interface)
      ? getBuiltinBaseName(types, source!)
      : undefined

  // also an interface extending a view of one (`interface Sized extends Pick<Uint8Array, 'length'>`)
  return base !== undefined
    ? TYPED_ARRAYS.has(base) || undefined
    : getViewBases(source!).filter((view) => isTypedArray(types, view))
}

/**
 * A class or interface the runtime declares, like `Date` or `Readable`,
 * not the anonymous types of library aliases like `Omit<User, 'password'>`.
 */
export function getDeclaredBuiltinName(types: TypeQueries, type: Type): string | undefined {
  const symbol = type.getSymbol()

  return symbol &&
    symbol.flags & (SymbolFlags.Interface | SymbolFlags.Class) &&
    isBuiltinSymbol(types, symbol)
    ? symbol.name
    : undefined
}

/**
 * Library interfaces without a global of their name whose values the runtime creates as plain data,
 * written by their members
 */
const PLAIN_DATA_INTERFACES = new Set([
  'PromiseFulfilledResult',
  'PromiseRejectedResult',
  'IteratorYieldResult',
  'IteratorReturnResult',
])

/**
 * How `JSON.stringify` writes a built-in by its own fields, as it writes what `toJSON` returned:
 * boxed primitives as primitives, other built-ins have no own enumerable data.
 * Also through a mapped type, like `Readonly<Date>`.
 *
 * `'members'` for a library interface without a global of its name (`Iterable<T>`, `ArrayLike<T>`,
 * `Body`), whose values are other values written by their members (an array, a string), or instances
 * of runtime classes, whose getters are not written (a `Response` as `{}`).
 */
export function getBuiltinFields(
  types: TypeQueries,
  type: Type,
): JsonSchema | 'members' | undefined {
  const declared = getDeclaredBuiltinName(types, type)

  if (declared !== undefined && !((type.getSymbol()?.flags ?? 0) & SymbolFlags.Value)) {
    return PLAIN_DATA_INTERFACES.has(declared) ? undefined : 'members'
  }

  const builtin = declared ?? getMappedBuiltinName(types, type)

  if (builtin === undefined) {
    return undefined
  }

  // boxed primitives are written as their primitive (`new String('x')` as `"x"`), and an `Object`
  // is any value but `null` and `undefined`
  return BOXED_PRIMITIVES[builtin]?.(true) ?? (builtin === 'Object' ? {} : { type: 'object' })
}

/**
 * How `JSON.stringify` writes an instance of a subclass of a boxed primitive
 * (`class Tag extends String`): as its primitive (`new String('x')` as `"x"`).
 */
export function getBoxedPrimitiveSchema(types: TypeQueries, type: Type): JsonSchema | undefined {
  const name = getBuiltinBaseName(types, type)

  return name === undefined ? undefined : BOXED_PRIMITIVES[name]?.(true)
}

/**
 * `DeepReadonly<Date>` or `DeepPartial<Set<string>>` maps over the built-in's methods,
 * but the value is still the built-in and serialized like it.
 */
function getMappedBuiltin(types: TypeQueries, type: Type, stringify: boolean): Builtin | undefined {
  // a view keeping the source's values (`Readonly<Error>`, `Partial<RegExp>`) is still the built-in
  // (not a view of a project class extending one, `Pick<MyDate, 'label'>` may be a plain object)
  // also over an intersection with a built-in (`Readonly<Set<string> & { x: string }>`)
  const members = types.getMappedSourceMembers(type)
  const viewed = members.length === 1 ? members[0] : undefined
  const viewedMember = members.find((m) => getDeclaredBuiltinName(types, m) !== undefined)
  const viewedBuiltin =
    viewedMember &&
    // a typed array is written by its own keys, also the ones an intersection adds
    !(viewedMember !== viewed && isTypedArray(types, viewedMember))
      ? getBuiltin(types, viewedMember, stringify)
      : undefined
  if (viewedBuiltin !== undefined) {
    return viewedBuiltin
  }

  // a view of an interface extending a built-in or a view of one (`Readonly<Link>` with
  // `interface Link extends Pick<URL, 'href'>`) is the built-in or a plain object, like the interface
  // (one extending a project class is a view of the class)
  const viewedSymbol = viewed?.getSymbol()
  if (
    viewed &&
    viewedSymbol &&
    viewedSymbol.flags & SymbolFlags.Interface &&
    !(viewedSymbol.flags & SymbolFlags.Class) &&
    !extendsProjectClass(types, viewed, new Set())
  ) {
    const extended = getBuiltin(types, viewed, stringify)
    if (extended !== undefined) {
      return extended
    }
  }

  const builtin = getMappedBuiltinName(types, type)

  if (builtin === undefined) {
    return undefined
  }

  // `DeepReadonly<Set<string>>` still knows its item type, `Readonly<Uint8Array>` is still a typed array
  // (by its argument: the members already showed it maps over the built-in)
  const [source] = types.getTypeArguments(type)
  if (source && source.flags & TypeFlags.Object && source.getSymbol()?.name === builtin) {
    const precise = getBuiltin(types, source, stringify)
    if (precise !== undefined) {
      return precise
    }
  }

  if (builtin === 'Set' || builtin === 'ReadonlySet') {
    return stringify ? emptyObject() : { kind: 'set', items: [] }
  }

  if (builtin === 'Map' || builtin === 'ReadonlyMap') {
    return stringify ? emptyObject() : { kind: 'map-entries', entries: [] }
  }

  return getLeaf(builtin, stringify)
}

/**
 * The built-in a mapped type maps over, like `Date` for `DeepReadonly<Date>`: a binary one
 * by its source (`Readonly<Uint8Array>`), the others by their members, which keep the built-in's
 * own declarations (`Date#getTime`) and tell `Map` apart from look-alikes like `URLSearchParams`.
 */
function getMappedBuiltinName(types: TypeQueries, type: Type): string | undefined {
  if (!((type as any).objectFlags & ObjectFlags.Mapped)) {
    return undefined
  }

  const source = types.getMappedSource(type)?.getSymbol()
  if (source && BINARY.has(source.name) && isBuiltinSymbol(types, source)) {
    return source.name
  }

  const properties = types.getProperties(type)

  if (!properties.length || !properties.every((p) => isBuiltinSymbol(types, p))) {
    return undefined
  }

  const byName = new Map(properties.map((p) => [p.name, p]))

  return MAPPED_BUILTIN_FINGERPRINTS.find(([name, members]) => {
    const global = types.getGlobalType(name)

    return (
      global !== undefined &&
      members.every((member) => {
        const own = types.checker.getPropertyOfType(global, member)?.declarations[0]
        const mapped = byName.get(member)?.declarations[0]
        return own && mapped && own.path === mapped.path && own.index === mapped.index
      })
    )
  })?.[0]
}

/**
 * Whether an interface extends a class declared outside the runtime, also through other interfaces.
 */
function extendsProjectClass(types: TypeQueries, type: Type, visited: Set<number>): boolean {
  const target = type.isTypeReference() ? type.getTarget() : type

  if (visited.has(target.id)) {
    return false
  }
  visited.add(target.id)

  return (target.getBaseTypes() ?? []).some((base) => {
    const symbol = base.getSymbol()
    return (
      symbol !== undefined &&
      !isBuiltinSymbol(types, symbol) &&
      (Boolean(symbol.flags & SymbolFlags.Class) ||
        (Boolean(symbol.flags & SymbolFlags.Interface) &&
          extendsProjectClass(types, base, visited)))
    )
  })
}

/**
 * A class extending a built-in, like `Map`, `Set`, `Array`, or `Date`, is serialized like it,
 * the serializer checks with `instanceof` and `Array.isArray`.
 */
function getBuiltinSubclass(
  types: TypeQueries,
  type: Type,
  stringify: boolean,
): Builtin | undefined {
  const base = getBuiltinBaseName(types, type)

  if (base === undefined) {
    // an interface extending a view of a built-in (`interface Link extends Pick<URL, 'href'>`)
    // holds the built-in or a plain object
    for (const view of getViewBases(type)) {
      // a typed array is written by its index keys and the fields the interface adds
      if (isTypedArray(types, view)) {
        continue
      }

      const builtin = getMappedBuiltin(types, view, stringify)
      if (builtin !== undefined) {
        return builtin
      }
    }

    return undefined
  }

  if (base === 'Array' || base === 'ReadonlyArray') {
    return { kind: 'array', items: getNumberIndexType(types, type) }
  }

  if (base === 'Set' || base === 'Map') {
    if (stringify) {
      return emptyObject()
    }

    const items =
      getIteratorTypes(types.checker, type, types.getProperties(type), false)?.yieldTypes ?? []

    return base === 'Set' ? { kind: 'set', items } : { kind: 'map-entries', entries: items }
  }

  return getLeaf(base, stringify)
}

/**
 * Built-ins whose instances the serializer leaves to `JSON.stringify`, which calls their `toJSON`
 * (it writes `Date`, `URL`, `Set`, `Map`, and `Blob` itself, and walks arrays and plain objects)
 */
const STRINGIFIED_BUILTINS = new Set([
  'Error',
  'RegExp',
  'ArrayBuffer',
  'SharedArrayBuffer',
  'DataView',
  'Promise',
])

/**
 * Whether the serializer leaves a value of this type to `JSON.stringify`: an instance of a built-in
 * like `Error` (also `TypeError`), or of a class extending one, not a view or an interface
 * extending one, which may be a plain object.
 */
export function isStringifiedBuiltin(types: TypeQueries, type: Type): boolean {
  const symbol = type.getSymbol()

  return (
    symbol !== undefined &&
    Boolean(
      symbol.flags & SymbolFlags.Class ||
      (symbol.flags & SymbolFlags.Interface && isBuiltinSymbol(types, symbol)),
    ) &&
    [getDeclaredBuiltinName(types, type), getBuiltinBaseName(types, type)].some(
      (name) => name !== undefined && STRINGIFIED_BUILTINS.has(name),
    )
  )
}

/**
 * The value type of the number index signature of a type, like the items of an array.
 */
export function getNumberIndexType(types: TypeQueries, type: Type): Type | undefined {
  return types.checker
    .getIndexInfosOfType(type)
    .find((info) => info.keyType.flags & TypeFlags.Number)?.valueType
}

/**
 * The name of the default library class a class extends, also through other classes.
 */
export function getBuiltinBaseName(types: TypeQueries, type: Type): string | undefined {
  return types.memo('builtinBaseName', type.id, () => getBuiltinBase(types, type)?.name)
}

/**
 * The default library class a class extends, also through other classes, and through a mixin
 * applied to it (`class Tags extends Tagged(Set<string>)`, whose base is an intersection with it).
 */
function getBuiltinBase(types: TypeQueries, type: Type, depth = 0): TSSymbol | undefined {
  const target = type.isTypeReference() ? type.getTarget() : type
  const bases = (target.getBaseTypes() ?? []).flatMap((base) =>
    base.isIntersectionType() ? types.getMembers(base) : [base],
  )

  for (const base of bases) {
    const symbol = base.getSymbol()

    // also the runtime's globals, like `File` from `@types/node` without the DOM library,
    // which zod's own `File` interface extends (not a library mapped type, `Pick<URL, 'href'>`)
    if (
      symbol &&
      isBuiltinSymbol(types, symbol) &&
      !((base as any).objectFlags & ObjectFlags.Mapped)
    ) {
      return symbol
    }

    const found = depth < 16 ? getBuiltinBase(types, base, depth + 1) : undefined
    if (found) {
      return found
    }
  }

  return undefined
}

/**
 * The mapped types an interface extends, also through other interfaces
 * (`interface Link extends Pick<URL, 'href'>`).
 */
export function getViewBases(type: Type, depth = 0): Type[] {
  const symbol = type.getSymbol()

  if (!symbol || !(symbol.flags & SymbolFlags.Interface) || depth > 16) {
    return []
  }

  const target = type.isTypeReference() ? type.getTarget() : type

  return (target.getBaseTypes() ?? []).flatMap((base) =>
    (base as any).objectFlags & ObjectFlags.Mapped ? [base] : getViewBases(base, depth + 1),
  )
}

/**
 * Whether a declared interface extends a built-in class (`interface AppError extends Error`),
 * also through a view of it (`Readonly<AppError>`), so a value may be an instance, which does not
 * write the members it inherits from the built-in.
 * Not a library interface of plain data, like `PromiseFulfilledResult<T>`.
 */
export function extendsBuiltinClass(types: TypeQueries, view: Type): boolean {
  // also of a member of an intersection (`AppError & { extra: string }`)
  const members =
    (view as any).objectFlags & ObjectFlags.Mapped
      ? types.getMappedSourceMembers(view)
      : view.isIntersectionType()
        ? types.getMembers(view)
        : undefined

  if (members) {
    return members.some((member) => extendsBuiltinClass(types, member))
  }

  const symbol = view.getSymbol()
  const base =
    symbol && symbol.flags & SymbolFlags.Interface ? getBuiltinBase(types, view) : undefined
  return base !== undefined && Boolean(base.flags & (SymbolFlags.Class | SymbolFlags.Variable))
}

/**
 * Declared by the runtime: the default library, or typings of runtime modules like `node:stream`.
 * With `isError`, for members of `Error` subclasses, everything declared outside the project.
 */
export function isBuiltinSymbol(types: TypeQueries, symbol: TSSymbol, isError = false): boolean {
  const isRuntime = (declaration: TSSymbol['declarations'][number]) => {
    const kind = types.getSourceKind(declaration.path)
    return (
      kind === 'default' ||
      (kind === 'external' && (isError || RUNTIME_TYPINGS.test(declaration.path)))
    )
  }

  // a global stays built-in when a package augments it (`declare global { interface Error }`),
  // members of `Error` subclasses are built-in when declared outside the project
  return isError
    ? symbol.declarations.length > 0 && symbol.declarations.every(isRuntime)
    : symbol.declarations.some(isRuntime)
}

/**
 * The boxed `BigInt` (also describing bigints, `const n: BigInt = 1n`), which the serializer
 * leaves to `JSON.stringify` when boxed.
 */
export function isBoxedBigInt(types: TypeQueries, type: Type): boolean {
  const symbol = type.getSymbol()
  return (
    symbol?.name === 'BigInt' &&
    Boolean(symbol.flags & SymbolFlags.Interface) &&
    types.getSymbolSourceKind(symbol) === 'default'
  )
}

/**
 * Whether `JSON.stringify` can write a bigint: `BigInt.prototype.toJSON` is polyfilled
 * (`declare global { interface BigInt { toJSON(): string } }`).
 */
export function hasBigIntToJSON(types: TypeQueries): boolean {
  const bigint = types.getGlobalType('BigInt')
  return bigint !== undefined && getToJSON(types, bigint) !== undefined
}

export function getToJSON(types: TypeQueries, type: Type): TSSymbol | undefined {
  return types.getProperty(type, 'toJSON')
}

/**
 * Whether a type has the `toJSON` of a built-in, as a view of it keeps (`Readonly<Date>`,
 * `Pick<Date, 'toJSON'>`), so it adds none to the built-in.
 */
export function hasToJSONOf(types: TypeQueries, type: Type, builtin: Type): boolean {
  const own = getToJSON(types, builtin)?.declarations[0]
  const other = getToJSON(types, type)?.declarations[0]
  return own !== undefined && other?.path === own.path && other.index === own.index
}

function hasOwnToJSON(types: TypeQueries, type: Type): boolean {
  const toJSON = getToJSON(types, type)
  return toJSON !== undefined && !isBuiltinSymbol(types, toJSON)
}

function getLeaf(name: string, stringify: boolean): Builtin | undefined {
  // `JSON.stringify` has no handling for binary values, they become `{}`
  const schema: JsonSchema | undefined =
    stringify && (name === 'Blob' || name === 'File')
      ? { type: 'object' }
      : (BOXED_PRIMITIVES[name]?.(stringify) ?? getLeafBuiltinSchema(name))

  return schema === undefined ? undefined : { kind: 'schema', schema }
}

/**
 * `String` and the other boxed types also describe primitives (`const s: String = 'a'`),
 * and boxed values serialize like them.
 */
const BOXED_PRIMITIVES: Record<string, ((stringify: boolean) => JsonSchema) | undefined> = {
  String: () => ({ type: 'string' }),
  Number: () => ({ type: 'number' }),
  Boolean: () => ({ type: 'boolean' }),
  // `JSON.stringify` throws on a bigint
  BigInt: (stringify) => (stringify ? { not: {} } : bigintSchema()),
}

function emptyObject(): Builtin {
  return { kind: 'schema', schema: { type: 'object' } }
}
