import type { JsonSchema } from '@orpc/json-schema'
import { stringifyJSON } from '@orpc/shared'
import type { Symbol as TSSymbol, Type } from 'typescript/unstable/sync'
import { ObjectFlags, SymbolFlags, TypeFlags } from 'typescript/unstable/sync'

import { bigintSchema, getLeafBuiltinSchema } from './schema-utils.ts'
import type { TypeQueries } from './type-queries.ts'
import { getIteratorTypes } from './utils.ts'

export const TYPED_ARRAYS = new Set([
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
    return { kind: 'schema', schema: TYPED_ARRAY_SCHEMA }
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

/** How the serializer and `JSON.stringify` write a typed array: by its index keys */
export const TYPED_ARRAY_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: { type: 'number' },
}

/**
 * Whether values of this type are typed arrays, also a subclass (Node's `Buffer`,
 * `class Bytes extends Uint8Array`) or through a mapped type (`Readonly<Uint8Array>`).
 * Unless `toJSON` is called, they are written by their index keys.
 */
export function isTypedArray(types: TypeQueries, type: Type): boolean {
  // `Uint8Array & { label: string }`
  if (type.isIntersectionType()) {
    return types.getMembers(type).some((member) => isTypedArray(types, member))
  }

  const source = (type as any).objectFlags & ObjectFlags.Mapped ? types.getMappedSource(type) : type
  const symbol = source?.getSymbol()

  if (!symbol) {
    return false
  }

  if (TYPED_ARRAYS.has(symbol.name) && isBuiltinSymbol(types, symbol)) {
    return true
  }

  const base =
    symbol.flags & (SymbolFlags.Class | SymbolFlags.Interface)
      ? getBuiltinBaseName(types, source!)
      : undefined
  return base !== undefined && TYPED_ARRAYS.has(base)
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
 * How `JSON.stringify` writes a built-in by its own fields, as it writes what `toJSON` returned:
 * typed arrays by their index keys, other built-ins have no own enumerable data.
 * Also through a mapped type, like `Readonly<Uint8Array>` or `Readonly<Date>`.
 */
export function getBuiltinFields(types: TypeQueries, type: Type): JsonSchema | undefined {
  if (isTypedArray(types, type)) {
    return TYPED_ARRAY_SCHEMA
  }

  const builtin = getDeclaredBuiltinName(types, type) ?? getMappedBuiltinName(types, type)
  return builtin === undefined ? undefined : { type: 'object' }
}

/**
 * `DeepReadonly<Date>` or `DeepPartial<Set<string>>` maps over the built-in's methods,
 * but the value is still the built-in and serialized like it.
 */
function getMappedBuiltin(types: TypeQueries, type: Type, stringify: boolean): Builtin | undefined {
  // a view keeping the source's values (`Readonly<Error>`, `Partial<RegExp>`) is still the built-in
  // (not a view of a project class extending one, `Pick<MyDate, 'label'>` may be a plain object)
  const viewed = types.getMappedSource(type)
  // also over an intersection with a built-in (`Readonly<Set<string> & { x: string }>`)
  const viewedMember = viewed?.isIntersectionType()
    ? types.getMembers(viewed).find((m) => getDeclaredBuiltinName(types, m) !== undefined)
    : viewed
  const viewedBuiltin =
    viewedMember && getDeclaredBuiltinName(types, viewedMember) !== undefined
      ? getBuiltin(types, viewedMember, stringify)
      : undefined
  if (viewedBuiltin !== undefined) {
    return viewedBuiltin
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
export function getMappedBuiltinName(types: TypeQueries, type: Type): string | undefined {
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
    return undefined
  }

  if (base === 'Array' || base === 'ReadonlyArray') {
    const items = types.checker
      .getIndexInfosOfType(type)
      .find((info) => info.keyType.flags & TypeFlags.Number)?.valueType
    return { kind: 'array', items }
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
 * The name of the default library class a class extends, also through other classes.
 */
export function getBuiltinBaseName(types: TypeQueries, type: Type, depth = 0): string | undefined {
  const target = type.isTypeReference() ? type.getTarget() : type

  for (const base of target.getBaseTypes() ?? []) {
    const symbol = base.getSymbol()

    // also the runtime's globals, like `File` from `@types/node` without the DOM library,
    // which zod's own `File` interface extends
    if (symbol && isBuiltinSymbol(types, symbol)) {
      return symbol.name
    }

    const name = depth < 16 ? getBuiltinBaseName(types, base, depth + 1) : undefined
    if (name) {
      return name
    }
  }

  return undefined
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

export function getToJSON(types: TypeQueries, type: Type): TSSymbol | undefined {
  return types.getProperties(type).find((p) => p.name === 'toJSON')
}

export function hasOwnToJSON(types: TypeQueries, type: Type): boolean {
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
