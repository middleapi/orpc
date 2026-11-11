import type { JsonSchema } from '@orpc/json-schema'
import { stringifyJSON } from '@orpc/shared'
import type { Symbol as TSSymbol, Type } from 'typescript/unstable/sync'
import { ObjectFlags, SignatureKind, SymbolFlags, TypeFlags } from 'typescript/unstable/sync'

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

    // `JSON.stringify` calls the own `toJSON` of a built-in subclass, the serializer does not,
    // unless it leaves the instance to `JSON.stringify` (`class MyNum extends Number`, also
    // `interface INum extends Number { toJSON(): string }`)
    return (
      runtimeGlobal ??
      // classes extending built-ins, and interfaces describing them (`interface Tags extends Set<string>`)
      (symbol.flags & (SymbolFlags.Class | SymbolFlags.Interface) &&
      !(
        (stringify || STRINGIFIED_BUILTINS.has(getBuiltinBaseName(types, type) ?? '')) &&
        hasOwnToJSON(types, type)
      )
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
 * `Set<any>` and `Map<any, any>`, if they satisfy an object type by their members, written as
 * arrays of items or entries: with every required property, or sharing one of a type of optional
 * properties only (`size` of `Partial<Shape>`).
 */
export function getSatisfyingCollections(types: TypeQueries, type: Type): readonly Type[] {
  return types.memo('satisfyingCollections', type.id, () =>
    getSatisfyingPrototypes(types, type, ['Set', 'Map']),
  )
}

/**
 * The typed arrays satisfying an object type by their members (`ArrayLike<number>`), written by
 * their index keys, `{ "0": 1 }`, which the fields of a type of optional properties only hold.
 * A bigint one writes `{}` or throws, which the form of a number one holds.
 */
export function getSatisfyingTypedArrays(types: TypeQueries, type: Type): readonly Type[] {
  return types.memo('satisfyingTypedArrays', type.id, () => {
    if (types.getProperties(type).every((p) => p.flags & SymbolFlags.Optional)) {
      return []
    }

    const numeric = getSatisfyingPrototypes(
      types,
      type,
      [...TYPED_ARRAYS].filter((name) => !name.startsWith('Big')),
    )
    return numeric.length
      ? numeric
      : getSatisfyingPrototypes(types, type, ['BigInt64Array', 'BigUint64Array'])
  })
}

function getSatisfyingPrototypes(
  types: TypeQueries,
  type: Type,
  names: readonly string[],
): readonly Type[] {
  const properties = types.getProperties(type)
  const weak = properties.every((p) => p.flags & SymbolFlags.Optional)

  return names.flatMap((name) => {
    const members = types.getGlobalType(name)
    const prototype = types.getPrototypeType(name)
    if (!members || !prototype) {
      return []
    }

    const memberNames = new Set(types.getProperties(members).map((p) => p.name))
    const ofMembers = weak
      ? properties.some((p) => memberNames.has(p.name))
      : properties.every((p) => p.flags & SymbolFlags.Optional || memberNames.has(p.name))
    return ofMembers && types.checker.isTypeAssignableTo(prototype, type) ? [prototype] : []
  })
}

/** Built-ins oRPC sends as the whole body itself, of these media types */
const BODY_MEDIA_TYPES: Record<string, string | undefined> = {
  ReadableStream: 'application/octet-stream',
  FormData: 'multipart/form-data',
  URLSearchParams: 'application/x-www-form-urlencoded',
}

/**
 * The media type oRPC sends a whole body of this type as, when it is a `ReadableStream`, a
 * `FormData`, or `URLSearchParams` (also of a class or an interface extending one, or of an
 * intersection with one), which it sends as is, not as JSON (a stream is not an event stream).
 * `view` for a view of one (`Readonly<FormData>`), which may also be a plain object.
 */
export function getBodyMediaType(
  types: TypeQueries,
  type: Type,
): { mediaType: string; view: boolean } | undefined {
  if (type.isIntersectionType()) {
    const bodies = types.getMembers(type).flatMap((m) => getBodyMediaType(types, m) ?? [])
    return bodies.find((body) => !body.view) ?? bodies[0]
  }

  const of = (source: Type) =>
    BODY_MEDIA_TYPES[
      getDeclaredBuiltinName(types, source) ??
        ((source.getSymbol()?.flags ?? 0) & (SymbolFlags.Class | SymbolFlags.Interface)
          ? (getBuiltinBaseName(types, source) ?? '')
          : '')
    ]

  const own = of(type)
  if (own !== undefined) {
    return { mediaType: own, view: false }
  }

  const viewed = getViewSources(types, type)
    .map(of)
    .find((mediaType) => mediaType !== undefined)
  return viewed === undefined ? undefined : { mediaType: viewed, view: true }
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
 * Node's `Buffer`, as `Buffer.alloc` returns it (`Buffer<ArrayBuffer>`), and what its own `toJSON`
 * returns (`{ type: 'Buffer'; data: number[] }`), which writes it in place of its index keys.
 * `undefined` without Node's typings.
 */
export function getNodeBuffer(
  types: TypeQueries,
): { buffer: Type; written: readonly Type[] } | undefined {
  return types.memo('nodeBuffer', 0, () => {
    const typeOf = (symbol: TSSymbol | undefined) => symbol && types.checker.getTypeOfSymbol(symbol)
    const returned = (method: Type | undefined) =>
      method
        ? types.checker
            .getSignaturesOfType(method, SignatureKind.Call)
            .flatMap((signature) => types.checker.getReturnTypeOfSignature(signature) ?? [])
        : []

    const constructor = types.checker.resolveName('Buffer', SymbolFlags.Value)
    const constructorType =
      constructor && isBuiltinSymbol(types, constructor) ? typeOf(constructor) : undefined
    const [buffer] = returned(
      typeOf(constructorType && types.getProperty(constructorType, 'alloc')),
    )
    const written = buffer ? returned(typeOf(types.getProperty(buffer, 'toJSON'))) : []
    return buffer && written.length ? { buffer, written } : undefined
  })
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
  const members = getViewParts(types, type) ?? [type]

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

  const builtin =
    declared ??
    getMappedBuiltinName(types, type) ??
    // a view of a global class, like `Readonly<Number>`
    types
      .getMappedSourceMembers(type)
      .filter((source) => (source.getSymbol()?.flags ?? 0) & SymbolFlags.Value)
      .map((source) => getDeclaredBuiltinName(types, source))
      .find((name) => name !== undefined)

  if (builtin === undefined) {
    return undefined
  }

  // boxed primitives are written as their primitive (`new String('x')` as `"x"`), and an `Object`
  // is any value but `null` and `undefined`
  return BOXED_PRIMITIVES[builtin]?.(true) ?? (builtin === 'Object' ? {} : { type: 'object' })
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
  const viewedMember =
    members.find((m) => getDeclaredBuiltinName(types, m) !== undefined) ??
    // or with a view of one (`Readonly<Readonly<Set<string>> & { x: string }>`), not of one
    // `JSON.stringify` writes by the `toJSON` the others add (`Readonly<Pick<Error, 'message'> & { toJSON(): string }>`)
    (members.length > 1
      ? members.find(
          (m) =>
            (m as any).objectFlags & ObjectFlags.Mapped &&
            !(
              getStringifiedForm(types, m) !== undefined &&
              members.some((other) => other !== m && hasOwnToJSON(types, other))
            ),
        )
      : undefined)
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
      // a typed array is written by its index keys and the fields the interface adds, and an
      // error (`interface AppError extends Readonly<Error>`) by its fields, as when extending one
      if (isTypedArray(types, view) || isViewOfFieldsBuiltin(types, view)) {
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

  // also an interface extending a readonly one (`interface Tags extends ReadonlySet<string>`), as a
  // value of `ReadonlySet<string>` is the set
  const collection = base.replace(/^Readonly/u, '')
  if (collection === 'Set' || collection === 'Map') {
    if (stringify) {
      return emptyObject()
    }

    const items =
      getIteratorTypes(types.checker, type, types.getProperties(type), false)?.yieldTypes ?? []

    return collection === 'Set' ? { kind: 'set', items } : { kind: 'map-entries', entries: items }
  }

  return getLeaf(base, stringify)
}

/**
 * Built-ins whose instances the serializer leaves to `JSON.stringify`, which calls their `toJSON`
 * (it writes `Date`, `URL`, `Set`, `Map`, and `Blob` itself, and walks arrays and plain objects),
 * also boxed primitives, which a value with a `toJSON` is (a primitive has none)
 */
const STRINGIFIED_BUILTINS = new Set([
  'Error',
  'RegExp',
  'ArrayBuffer',
  'SharedArrayBuffer',
  'DataView',
  'Promise',
  'String',
  'Number',
  'Boolean',
])

/**
 * Whether the serializer leaves a value of this type to `JSON.stringify`: an instance of a built-in
 * like `Error` (also `TypeError`), or of a class extending one, not a view or an interface
 * extending one, which may be a plain object.
 */
function isStringifiedBuiltin(types: TypeQueries, type: Type): boolean {
  const symbol = type.getSymbol()

  return (
    symbol !== undefined &&
    Boolean(
      symbol.flags & SymbolFlags.Class ||
      (symbol.flags & SymbolFlags.Interface && isBuiltinSymbol(types, symbol)),
    ) &&
    isOrExtendsBuiltin(types, type, STRINGIFIED_BUILTINS)
  )
}

/**
 * Whether the bracket notation of a parameter (`?a[b]=...`) sends a value of this type as
 * `String(value)`: a typed array (also Node's `Buffer`), or an instance the serializer leaves to
 * `JSON.stringify` (`RegExp`, `ArrayBuffer`, `Promise`), also through a view keeping all of its
 * members (`Readonly<RegExp>`), but a boxed primitive, which is sent as its primitive, and an
 * `Error`, which is sent as the plain object it may be, like a class.
 */
export function isSentAsString(types: TypeQueries, type: Type, depth = 0): boolean {
  if (
    (isTypedArray(types, type) && !getTypedArrayViewBases(types, type).length) ||
    (isStringifiedBuiltin(types, type) &&
      !isBoxedPrimitive(types, type) &&
      !extendsError(types, type))
  ) {
    return true
  }

  if (!((type as any).objectFlags & ObjectFlags.Mapped) || depth > 16) {
    return false
  }

  const [source, ...others] = types.getMappedSourceMembers(type)
  const properties = types.getProperties(type)

  return (
    source !== undefined &&
    !others.length &&
    isSentAsString(types, source, depth + 1) &&
    properties.length === types.getProperties(source).length &&
    !properties.some((p) => p.flags & SymbolFlags.Optional)
  )
}

/**
 * Whether a type is a built-in of one of these names, or extends one (`TypeError` is an `Error`).
 */
function isOrExtendsBuiltin(types: TypeQueries, type: Type, names: ReadonlySet<string>): boolean {
  return [getDeclaredBuiltinName(types, type), getBuiltinBaseName(types, type)].some(
    (name) => name !== undefined && names.has(name),
  )
}

/**
 * How the serializer leaves a value of this type to `JSON.stringify`: as an `instance` of a built-in
 * like `Error` (see `isStringifiedBuiltin`), or a `view` of one (`Readonly<Error>`, also an interface
 * extending one, `interface Msg extends Pick<Error, 'message'>`), which may also be a plain object
 * the serializer walks.
 */
export function getStringifiedForm(
  types: TypeQueries,
  type: Type,
): 'instance' | 'view' | undefined {
  if (isStringifiedBuiltin(types, type)) {
    return 'instance'
  }

  // also of an interface over a view of one (`Readonly<ROnum>` of
  // `interface ROnum extends Readonly<Number> { toJSON(): string }`)
  return getViewSources(types, type).some((source) => isStringifiedBuiltin(types, source))
    ? 'view'
    : undefined
}

/**
 * The types behind a view (`Readonly<A & B>`) and behind the views an interface extends
 * (`interface Link extends Pick<URL, 'href'>`), each followed by the types behind the views it
 * extends in turn (`Readonly<ROnum>` of `interface ROnum extends Readonly<Number>`).
 */
export function getViewSources(types: TypeQueries, type: Type): readonly Type[] {
  return types.memo('viewSources', type.id, () =>
    getSourcesOfViews(types, [type, ...getViewBases(type)], 0),
  )
}

function getSourcesOfViews(types: TypeQueries, views: readonly Type[], depth: number): Type[] {
  return depth > 16
    ? []
    : views.flatMap((view) =>
        types
          .getMappedSourceMembers(view)
          .flatMap((source) => [
            source,
            ...getSourcesOfViews(types, getViewBases(source), depth + 1),
          ]),
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
  const parts = getViewParts(types, view)

  if (parts) {
    return parts.some((part) => extendsBuiltinClass(types, part))
  }

  const symbol = view.getSymbol()
  if (!symbol || !(symbol.flags & SymbolFlags.Interface)) {
    return false
  }

  const base = getBuiltinBase(types, view)
  return (
    (base !== undefined && Boolean(base.flags & (SymbolFlags.Class | SymbolFlags.Variable))) ||
    getViewBases(view).some((viewBase) => isViewOfFieldsBuiltin(types, viewBase))
  )
}

/**
 * How `JSON.stringify` writes the boxed primitive a class or an interface extends
 * (`class Tag extends String`, `interface INum extends Number`), also through a view of it or an
 * intersection with it (`Partial<INum>`, `INum & { code: number }`): as its primitive
 * (`new String('x')` as `"x"`). A value of an interface may also be the primitive, or a plain object.
 */
export function getExtendedPrimitiveSchema(types: TypeQueries, view: Type): JsonSchema | undefined {
  const parts = getViewParts(types, view)

  if (parts) {
    return parts
      .map((part) => getExtendedPrimitiveSchema(types, part))
      .find((schema) => schema !== undefined)
  }

  const symbol = view.getSymbol()
  const base =
    symbol !== undefined && symbol.flags & (SymbolFlags.Class | SymbolFlags.Interface)
      ? getBuiltinBaseName(types, view)
      : undefined
  return base === undefined ? undefined : BOXED_PRIMITIVES[base]?.(true)
}

/**
 * The parts a value of a view or an intersection is made of: the members of an intersection, or
 * the types a mapped type maps over (`Readonly<A & B>`), `undefined` for other types.
 */
export function getViewParts(types: TypeQueries, type: Type): readonly Type[] | undefined {
  return type.isIntersectionType()
    ? types.getMembers(type)
    : (type as any).objectFlags & ObjectFlags.Mapped
      ? types.getMappedSourceMembers(type)
      : undefined
}

const ERROR: ReadonlySet<string> = new Set(['Error'])

/**
 * Whether a class or an interface extends `Error`, also through a view of it
 * (`interface AppError extends Readonly<Error>`), whose members from packages are not data.
 */
export function extendsError(types: TypeQueries, type: Type): boolean {
  return types.memo('extendsError', type.id, (): boolean =>
    [type, ...getSourcesOfViews(types, getViewBases(type), 0)].some((source) =>
      isOrExtendsBuiltin(types, source, ERROR),
    ),
  )
}

/**
 * Whether an interface extends a view of a built-in the serializer writes itself
 * (`interface Zoned extends Readonly<Date>`), whose instance `JSON.stringify` writes by its own
 * fields when `toJSON` returns it, as when extending the built-in (not a view of an error or a
 * boxed primitive, see `getBuiltinFields`).
 */
export function extendsBuiltinView(types: TypeQueries, type: Type): boolean {
  return getViewBases(type).some(
    (view) =>
      !isTypedArray(types, view) &&
      getStringifiedForm(types, view) === undefined &&
      getMappedBuiltin(types, view, true) !== undefined,
  )
}

/**
 * Whether a view is of a built-in that `JSON.stringify` writes by its fields, as an instance of a
 * class extending it (`Readonly<Error>`, not a boxed primitive, `Readonly<Number>`).
 */
function isViewOfFieldsBuiltin(types: TypeQueries, view: Type): boolean {
  return types
    .getMappedSourceMembers(view)
    .some((source) => isStringifiedBuiltin(types, source) && !isBoxedPrimitive(types, source))
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
 * Whether a type has only the `toJSON` of a built-in, as a view of it keeps (`Readonly<Date>`,
 * `Pick<Date, 'toJSON'>`), so it adds none to the built-in. Every declaration counts: the
 * `toJSON` of `Readonly<Date & { toJSON(): number }>` also has the date's own.
 */
export function hasToJSONOf(types: TypeQueries, type: Type, builtin: Type): boolean {
  const own = getToJSON(types, builtin)?.declarations ?? []
  const other = getToJSON(types, type)?.declarations ?? []
  return (
    own.length > 0 &&
    other.length > 0 &&
    other.every((d) => own.some((o) => o.path === d.path && o.index === d.index))
  )
}

/**
 * Whether an interface over a view of a built-in adds its own `toJSON`
 * (`interface ROnum extends Readonly<Number> { toJSON(): string }`), which an instance has.
 */
export function addsOwnToJSON(types: TypeQueries, type: Type): boolean {
  return getViewBases(type).length > 0 && hasOwnToJSON(types, type)
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
 * Whether a type is the interface of a boxed primitive (`Boolean`, `Number`), whose few members a
 * plain object easily has, as for a view of the primitive.
 */
export function isBoxedPrimitive(types: TypeQueries, type: Type): boolean {
  return BOXED_PRIMITIVES[getDeclaredBuiltinName(types, type) ?? ''] !== undefined
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
