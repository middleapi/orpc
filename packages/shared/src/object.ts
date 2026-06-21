import type { AnyFunction } from './function'
import { isTypescriptObject } from '@standardserver/shared'

export type Segment = string | number

export function findDeepMatches(
  check: (value: unknown) => boolean,
  payload: unknown,
  segments: Segment[] = [],
  maps: Segment[][] = [],
  values: unknown[] = [],
): { maps: Segment[][], values: unknown[] } {
  if (check(payload)) {
    maps.push(segments)
    values.push(payload)
  }
  else if (Array.isArray(payload)) {
    payload.forEach((v, i) => {
      findDeepMatches(check, v, [...segments, i], maps, values)
    })
  }
  else if (isPlainObject(payload)) {
    for (const key in payload) {
      findDeepMatches(check, payload[key], [...segments, key], maps, values)
    }
  }

  return { maps, values }
}

/**
 * Get constructor of the value
 *
 */
export function getConstructor(value: unknown): Function | null | undefined { // eslint-disable-line ts/no-unsafe-function-type
  // Object.getPrototypeOf require object in node.js
  if (!isTypescriptObject(value)) {
    return null
  }

  return Object.getPrototypeOf(value)?.constructor
}

/**
 * Checks whether a value is a plain object, including objects created with
 * `Object.create(null)`.
 */
export function isPlainObject(value: unknown): value is Record<PropertyKey, unknown> {
  if (!value || typeof value !== 'object') {
    return false
  }

  const proto = Object.getPrototypeOf(value)

  return proto === Object.prototype || !proto || !proto.constructor
}

export function get(object: unknown, path: readonly PropertyKey[]): unknown {
  let current: unknown = object

  for (const key of path) {
    if (!isTypescriptObject(current)) {
      return undefined
    }

    current = current[key]
  }

  return current
}

/**
 * Sets a value at the given path, creating plain objects for intermediate keys as needed.
 */
export function set(
  root: object,
  path: [PropertyKey, ...PropertyKey[]] | [ ...PropertyKey[], PropertyKey],
  value: unknown,
): void {
  let current: object = root

  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!
    const next = (current as Record<PropertyKey, unknown>)[key]

    if (!isTypescriptObject(next)) {
      ;(current as Record<PropertyKey, unknown>)[key] = {}
    }

    current = (current as Record<PropertyKey, object>)[key]!
  }

  ;(current as Record<PropertyKey, unknown>)[path.at(-1)!] = value
}

export function omit<T extends object, K extends keyof T>(
  obj: T,
  keys: readonly K[],
): Omit<T, K> {
  const result = { ...obj }

  for (const key of keys) {
    delete result[key]
  }

  return result
}

export function clone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(clone) as any
  }

  if (isPlainObject(value)) {
    const result: Record<PropertyKey, unknown> = {}

    for (const key in value) {
      result[key] = clone(value[key])
    }

    for (const sym of Object.getOwnPropertySymbols(value)) {
      result[sym] = clone(value[sym])
    }

    return result as any
  }

  return value
}

export function isPropertyKey(value: unknown): value is PropertyKey {
  const type = typeof value
  return type === 'string' || type === 'number' || type === 'symbol'
}

export const NullProtoObj = /* @__PURE__ */ (() => {
  const e = function () { }
  e.prototype = Object.create(null)
  Object.freeze(e.prototype)
  return e
})() as unknown as ({ new<T extends Record<PropertyKey, unknown>>(): T })

/**
 * Returns an object containing all methods of the given object, with each
 * method bound to the original object instance.
 *
 * Methods are collected from both the object itself and its prototype chain
 * (excluding `Object.prototype` and the `constructor` property).
 */
export function bindMethods<T extends object>(obj: T): Pick<T, { [K in keyof T]: T[K] extends AnyFunction ? K : never; }[keyof T]> {
  // Use NullProtoObj so special methods like toString and __proto__ are supported.
  const methods = new NullProtoObj()

  let current: object | null = obj
  while (current && current !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(current)) {
      if (key === 'constructor' || key in methods) {
        continue
      }

      const val = (obj as Record<PropertyKey, unknown>)[key]
      if (typeof val === 'function') {
        methods[key] = val.bind(obj)
      }
    }

    for (const sym of Object.getOwnPropertySymbols(current)) {
      if (sym in methods) {
        continue
      }

      const val = (obj as Record<PropertyKey, unknown>)[sym]
      if (typeof val === 'function') {
        methods[sym] = val.bind(obj)
      }
    }

    current = Object.getPrototypeOf(current)
  }

  return methods as any
}
