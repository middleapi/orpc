import type { AnyFunction } from './function'
import { getOrBind, isTypescriptObject } from '@standardserver/shared'

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

export function* getConstructors(value: unknown): Generator<Function> { // eslint-disable-line ts/no-unsafe-function-type
  if (!isTypescriptObject(value)) {
    return
  }

  let proto = Object.getPrototypeOf(value)
  while (proto != null) {
    if (proto.constructor) {
      yield proto.constructor
    }
    proto = Object.getPrototypeOf(proto)
  }
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

/**
 * Returns `object[key]` only when it is an own property, so keys like
 * `toString` do not resolve through the prototype chain.
 */
export function getOwn<T extends object>(object: T, key: PropertyKey): T[keyof T] | undefined {
  return Object.hasOwn(object, key) ? object[key as keyof T] : undefined
}

export function get(object: unknown, path: readonly PropertyKey[]): unknown {
  let current: unknown = object

  for (const key of path) {
    if (!isTypescriptObject(current) || !Object.hasOwn(current, key)) {
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
    const next = Object.hasOwn(current, key) ? (current as Record<PropertyKey, unknown>)[key] : undefined

    if (!isTypescriptObject(next)) {
      const child = {}
      defineOwnProperty(current, key, child)
      current = child
    }
    else {
      current = next
    }
  }

  defineOwnProperty(current, path.at(-1)!, value)
}

function defineOwnProperty(object: object, key: PropertyKey, value: unknown): void {
  Object.defineProperty(object, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  })
}

/**
 * Merges two values by copying the second over the first, repeating the merge one level deeper for
 * nested plain objects. Anything that is not a pair of plain objects is replaced by the second one.
 */
export function mergeTwoLevels(first: unknown, second: unknown): unknown {
  if (!isPlainObject(first) || !isPlainObject(second)) {
    return second
  }

  // Spread keeps special keys like __proto__ as own properties instead of re-parenting the result.
  const result: Record<PropertyKey, unknown> = { ...first, ...second }

  for (const key in second) {
    if (!Object.hasOwn(first, key)) {
      continue
    }

    const firstValue = first[key]
    const secondValue = second[key]

    if (isPlainObject(firstValue) && isPlainObject(secondValue)) {
      defineOwnProperty(result, key, { ...firstValue, ...secondValue })
    }
  }

  return result
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

    // Use defineOwnProperty so special keys like __proto__ don't re-parent the result.
    for (const key in value) {
      defineOwnProperty(result, key, clone(value[key]))
    }

    for (const sym of Object.getOwnPropertySymbols(value)) {
      defineOwnProperty(result, sym, clone(value[sym]))
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
export function bindMethods<T extends object>(
  obj: T,
  options: { unbound?: (keyof T)[] } = {},
): Pick<T, { [K in keyof T]: T[K] extends AnyFunction ? K : never; }[keyof T]> {
  const unbound = new Set<PropertyKey>(options.unbound)

  // Use NullProtoObj so special methods like toString and __proto__ are supported.
  const methods = new NullProtoObj()

  let current: object | null = obj
  while (current && current !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(current)) {
      if (key === 'constructor' || key in methods) {
        continue
      }

      const val = getOrBind(obj, key, { bind: !unbound.has(key) })
      if (typeof val === 'function') {
        methods[key] = val
      }
    }

    for (const sym of Object.getOwnPropertySymbols(current)) {
      if (sym in methods) {
        continue
      }

      const val = getOrBind(obj, sym, { bind: !unbound.has(sym) })
      if (typeof val === 'function') {
        methods[sym] = val
      }
    }

    current = Object.getPrototypeOf(current)
  }

  return methods as any
}
