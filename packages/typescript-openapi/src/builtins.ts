import type { JsonSchema } from '@orpc/json-schema'
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
const RUNTIME_TYPINGS = /\/node_modules\/(?:@types\/(?:node|bun|deno)|bun-types)\//u

/**
 * How a built-in value is serialized: as a final schema, or as an array, `Set`, or `Map`
 * of element types still to convert.
 */
export type Builtin =
  | { kind: 'schema'; schema: JsonSchema }
  | { kind: 'array' | 'set'; items: Type | undefined }
  /** Entries as `[key, value]` tuples */
  | { kind: 'map'; key: Type | undefined; value: Type | undefined }
  /** Entries of one type, like the iterated `[string, number]` of a `Map` subclass */
  | { kind: 'map-entries'; entry: Type | undefined }

/**
 * The built-in a value of this type is, like `Date`, `Set<T>`, a typed array, or a subclass
 * of one. `stringify` applies the rules of `JSON.stringify`, which writes `Set`, `Map`,
 * and binary values as `{}`.
 */
export function getBuiltin(
  types: TypeQueries,
  type: Type,
  stringify: boolean,
): Builtin | undefined {
  const symbol = type.getSymbol()

  if (!symbol) {
    return undefined
  }

  // only globals of the default library, a `File` or `Map` class of a package is its own type
  if (types.getSymbolSourceKind(symbol) !== 'default') {
    // `Blob`, `File`, and `URL` without the DOM library come from the runtime's typings
    const runtimeGlobal =
      symbol.declarations.length > 0 &&
      symbol.declarations.every((d) => RUNTIME_TYPINGS.test(d.path))
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

  const leaf = getLeaf(symbol.name, stringify)
  if (leaf) {
    return leaf
  }

  if (TYPED_ARRAYS.has(symbol.name)) {
    // serialized like an object with index keys, `{ "0": 1, "1": 2 }`
    return { kind: 'schema', schema: { type: 'object', additionalProperties: { type: 'number' } } }
  }

  const [first, second] = types.getReferenceArguments(type)

  switch (symbol.name) {
    case 'Set':
    case 'ReadonlySet':
      return stringify ? emptyObject() : { kind: 'set', items: first }
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
 * `DeepReadonly<Date>` or `DeepPartial<Set<string>>` maps over the built-in's methods,
 * but the value is still the built-in and serialized like it.
 */
export function getMappedBuiltin(
  types: TypeQueries,
  type: Type,
  stringify: boolean,
): Builtin | undefined {
  const builtin = getMappedBuiltinName(types, type)

  if (builtin === undefined) {
    return undefined
  }

  // `DeepReadonly<Set<string>>` still knows its item type
  const [source] = types.getTypeArguments(type)
  if (source && source.flags & TypeFlags.Object && source.getSymbol()?.name === builtin) {
    const precise = getBuiltin(types, source, stringify)
    if (precise !== undefined) {
      return precise
    }
  }

  if (builtin === 'Set' || builtin === 'ReadonlySet') {
    return stringify ? emptyObject() : { kind: 'set', items: undefined }
  }

  if (builtin === 'Map' || builtin === 'ReadonlyMap') {
    return stringify ? emptyObject() : { kind: 'map-entries', entry: undefined }
  }

  return getLeaf(builtin, stringify)
}

/**
 * The built-in a mapped type maps over, like `Date` for `DeepReadonly<Date>`: its members keep
 * the built-in's own declarations (`Date#getTime`), which tells `Map` apart from look-alikes
 * such as `URLSearchParams`.
 */
export function getMappedBuiltinName(types: TypeQueries, type: Type): string | undefined {
  if (!((type as any).objectFlags & ObjectFlags.Mapped)) {
    return undefined
  }

  const properties = types.getProperties(type)

  if (!properties.length || !properties.every((p) => isBuiltinMember(types, p, false))) {
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
    const item = getIteratorTypes(types.checker, type, types.getProperties(type), false)?.yieldType

    if (stringify) {
      return emptyObject()
    }

    return base === 'Set' ? { kind: 'set', items: item } : { kind: 'map-entries', entry: item }
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
 * For `Error` subclasses, everything declared outside the project.
 */
export function isBuiltinMember(types: TypeQueries, symbol: TSSymbol, isError: boolean): boolean {
  return (
    symbol.declarations.length > 0 &&
    symbol.declarations.every((declaration) => {
      const kind = types.getSourceKind(declaration.path)
      return (
        kind === 'default' ||
        (kind === 'external' && (isError || RUNTIME_TYPINGS.test(declaration.path)))
      )
    })
  )
}

/**
 * Declared by the default library or the runtime's typings.
 */
export function isBuiltinSymbol(types: TypeQueries, symbol: TSSymbol): boolean {
  return (
    symbol.declarations.length > 0 &&
    symbol.declarations.every(
      (d) => types.getSourceKind(d.path) === 'default' || RUNTIME_TYPINGS.test(d.path),
    )
  )
}

export function getToJSON(types: TypeQueries, type: Type): TSSymbol | undefined {
  return types.getProperties(type).find((p) => p.name === 'toJSON')
}

export function hasOwnToJSON(types: TypeQueries, type: Type): boolean {
  const toJSON = getToJSON(types, type)
  return toJSON !== undefined && !isBuiltinMember(types, toJSON, false)
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
