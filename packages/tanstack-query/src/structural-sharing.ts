import type { RPCJsonSerializer } from '@orpc/client'
import type { Public } from '@orpc/shared'
import { setOwn, stringifyJSON } from '@orpc/shared'

export type StructuralSharing = <T>(oldData: unknown, newData: T) => T

/**
 * Creates a `structuralSharing` function that works like TanStack Query's default, but also keeps
 * the previous reference for equal `Date`, `URL`, `Map` and `Set` values, which oRPC's serializer
 * recreates on every response, and for custom types that serialize the same with a type-aware
 * serializer like `RPCJsonSerializer`.
 *
 * Used by default in `.queryOptions`, `.liveOptions` and `.infiniteOptions`, pass `structuralSharing: false` to opt out.
 *
 * @see {@link https://orpc.dev/docs/integrations/tanstack-query#structural-sharing | TanStack Query Integration - Structural Sharing}
 */
export function createStructuralSharing(serializer?: Public<RPCJsonSerializer>): StructuralSharing {
  return (oldData, newData) => replaceEqualDeep(oldData, newData, 0, serializer)
}

function replaceEqualDeep(a: any, b: any, depth: number, serializer: Public<RPCJsonSerializer> | undefined): any {
  if (Object.is(a, b)) {
    return a
  }

  if (depth > 500 || typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return b
  }

  const proto = Object.getPrototypeOf(a)

  if (proto !== Object.getPrototypeOf(b)) {
    return b
  }

  if (
    (proto === Date.prototype || proto === URL.prototype || proto === Set.prototype || proto === Map.prototype)
    && !hasOwnEnumerableKey(a)
    && !hasOwnEnumerableKey(b)
  ) {
    return replaceEqualBuiltIn(a, b, proto, depth, serializer)
  }

  if (Array.isArray(a)) {
    return isPlainArray(a) && isPlainArray(b) ? replaceEqualArray(a, b, depth, serializer) : b
  }

  // same rule as isPlainObject, but reusing the prototype read above is about 15% faster
  if (proto === Object.prototype || proto === null || !proto.constructor) {
    return replaceEqualObject(a, b, proto, depth, serializer)
  }

  return replaceEqualSerialized(a, b, depth, serializer)
}

function replaceEqualArray(a: any[], b: any[], depth: number, serializer: Public<RPCJsonSerializer> | undefined): any[] {
  let copy: any[] | undefined

  for (let i = 0; i < b.length; i++) {
    let value = b[i]

    if (i < a.length) {
      const aValue = a[i]

      if (typeof aValue === 'object' && typeof value === 'object') {
        value = replaceEqualDeep(aValue, value, depth + 1, serializer)
      }

      if (copy === undefined && Object.is(value, aValue)) {
        continue
      }
    }

    copy ??= copyArrayPrefix(a, i)
    copy.push(value)
  }

  return copy ?? (a.length === b.length ? a : copyArrayPrefix(a, b.length))
}

function copyArrayPrefix(a: any[], end: number): any[] {
  const copy = []

  for (let i = 0; i < end; i++) {
    copy.push(a[i])
  }

  return copy
}

function replaceEqualObject(a: any, b: any, proto: object | null, depth: number, serializer: Public<RPCJsonSerializer> | undefined): any {
  const bKeys = Object.keys(b)
  let copy: any

  for (let i = 0; i < bKeys.length; i++) {
    const key = bKeys[i]!
    let value = b[key]

    if (Object.hasOwn(a, key)) {
      const aValue = a[key]

      if (typeof aValue === 'object' && typeof value === 'object') {
        value = replaceEqualDeep(aValue, value, depth + 1, serializer)
      }

      if (copy === undefined && Object.is(value, aValue)) {
        continue
      }
    }

    copy ??= copyObjectPrefix(a, bKeys, i, proto)
    assign(copy, key, value)
  }

  return copy ?? (Object.keys(a).length === bKeys.length ? a : copyObjectPrefix(a, bKeys, bKeys.length, proto))
}

function copyObjectPrefix(a: any, keys: string[], end: number, proto: object | null): any {
  const copy = proto === Object.prototype ? {} : Object.create(proto)

  for (let i = 0; i < end; i++) {
    assign(copy, keys[i]!, a[keys[i]!])
  }

  return copy
}

function assign(object: any, key: string, value: unknown): void {
  // same as always calling setOwn, but a plain assignment keeps the copy loops about 30% faster
  if (key === '__proto__') {
    setOwn(object, key, value)
  }
  else {
    object[key] = value
  }
}

function replaceEqualBuiltIn(a: any, b: any, proto: object, depth: number, serializer: Public<RPCJsonSerializer> | undefined): object {
  if (proto === Date.prototype) {
    return Object.is(a.getTime(), b.getTime()) ? a : b
  }

  if (proto === URL.prototype) {
    return a.href === b.href ? a : b
  }

  if (a.size !== b.size) {
    return b
  }

  if (proto === Set.prototype) {
    const aValues = a.values()

    for (const bValue of b.values()) {
      const aValue = aValues.next().value

      if (!Object.is(replaceEqualDeep(aValue, bValue, depth + 1, serializer), aValue)) {
        return b
      }
    }

    return a
  }

  const aKeys = a.keys()
  const aValues = a.values()
  const bValues = b.values()

  for (const bKey of b.keys()) {
    const aKey = aKeys.next().value
    const aValue = aValues.next().value

    if (
      !Object.is(replaceEqualDeep(aKey, bKey, depth + 1, serializer), aKey)
      || !Object.is(replaceEqualDeep(aValue, bValues.next().value, depth + 1, serializer), aValue)
    ) {
      return b
    }
  }

  return a
}

function replaceEqualSerialized(a: object, b: object, depth: number, serializer: Public<RPCJsonSerializer> | undefined): object {
  const aSerialized = serializer?.serializeJson(a)

  if (!aSerialized?.meta?.length) {
    return b
  }

  const bSerialized = serializer!.serializeJson(b)

  return stringifyJSON(aSerialized.meta) === stringifyJSON(bSerialized.meta)
    && Object.is(replaceEqualDeep(aSerialized.json, bSerialized.json, depth + 1, serializer), aSerialized.json)
    ? a
    : b
}

function hasOwnEnumerableKey(value: object): boolean {
  // for...in avoids the array allocation of Object.keys, which matters on this hot path
  for (const key in value) {
    if (Object.hasOwn(value, key)) {
      return true
    }
  }

  return false
}

function isPlainArray(value: unknown[]): boolean {
  return value.length === Object.keys(value).length
}
