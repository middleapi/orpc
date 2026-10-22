import type { RPCJsonSerializationMeta } from '@orpc/client'
import type { Public } from '@orpc/shared'
import { RPCJsonSerializer } from '@orpc/client'
import { isPlainObject, setOwn } from '@orpc/shared'

export type StructuralSharing = <T>(oldData: unknown, newData: T) => T

const defaultSerializer = new RPCJsonSerializer()

/**
 * Creates a `structuralSharing` function that works like TanStack Query's default, but also keeps
 * the previous reference for values that serialize the same, such as `Date`, `URL`, `Map`, `Set`
 * and custom types, which oRPC's serializer recreates on every response.
 *
 * Used by default in `.queryOptions`, `.liveOptions` and `.infiniteOptions`, pass `structuralSharing: false` to opt out.
 *
 * @see {@link https://orpc.dev/docs/integrations/tanstack-query#structural-sharing | TanStack Query Integration - Structural Sharing}
 */
export function createStructuralSharing(serializer: Public<RPCJsonSerializer> = defaultSerializer): StructuralSharing {
  return (oldData, newData) => replaceEqualDeep(oldData, newData, 0, serializer)
}

function replaceEqualDeep(a: any, b: any, depth: number, serializer: Public<RPCJsonSerializer>): any {
  if (Object.is(a, b)) {
    return a
  }

  if (depth > 500 || typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return b
  }

  const proto = Object.getPrototypeOf(a)

  // the serializer compares content, not class, so a subclass would otherwise pass for its parent
  if (proto !== Object.getPrototypeOf(b)) {
    return b
  }

  // the most common non-JSON value, compared directly since serializing it is much slower
  if (proto === Date.prototype) {
    return Object.is(a.getTime(), b.getTime()) ? a : b
  }

  const isArray = Array.isArray(a)

  if (isArray ? !isPlainArray(a) || !isPlainArray(b) : !isPlainObject(a)) {
    return isArray ? b : replaceEqualSerialized(a, b, depth, serializer)
  }

  const aKeys = isArray ? a : Object.keys(a)
  const bKeys = isArray ? b : Object.keys(b)
  const copy: any = isArray ? [] : {}
  let equalItems = 0

  for (let i = 0; i < bKeys.length; i++) {
    const key = isArray ? i : bKeys[i]
    let value = b[key]

    if (isArray ? i < aKeys.length : Object.hasOwn(a, key)) {
      const aValue = a[key]

      // only recurse into objects, a primitive is shared exactly when it is the same value
      if (typeof aValue === 'object' && typeof value === 'object') {
        value = replaceEqualDeep(aValue, value, depth + 1, serializer)
      }

      if (Object.is(value, aValue)) {
        equalItems++
      }
    }

    if (key === '__proto__') {
      setOwn(copy, key, value)
    }
    else {
    // same as always calling setOwn, but a plain assignment keeps this hot loop about 30% faster
      copy[key] = value
    }
  }

  return aKeys.length === bKeys.length && equalItems === aKeys.length ? a : copy
}

/**
 * Shares a non-plain object, like a `Map` or a custom type, when it serializes the same as the previous one.
 */
function replaceEqualSerialized(a: object, b: object, depth: number, serializer: Public<RPCJsonSerializer>): object {
  const aSerialized = serializer.serializeJson(a)

  // no handler knows this type
  if (aSerialized.json === a) {
    return b
  }

  const bSerialized = serializer.serializeJson(b)

  // compare only the payload and the flat meta, walking the whole serialization would copy its wrapper
  return isSameMeta(aSerialized.meta, bSerialized.meta)
    && Object.is(replaceEqualDeep(aSerialized.json, bSerialized.json, depth + 1, serializer), aSerialized.json)
    ? a
    : b
}

function isSameMeta(a: RPCJsonSerializationMeta[] = [], b: RPCJsonSerializationMeta[] = []): boolean {
  return a.length === b.length && a.every((entry, i) => {
    const other = b[i]!
    return entry.length === other.length && entry.every((segment, j) => segment === other[j])
  })
}

function isPlainArray(value: unknown[]): boolean {
  return value.length === Object.keys(value).length
}
