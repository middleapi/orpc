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
  else if (isObject(payload)) {
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
 * Check if the value is an object even it created by `Object.create(null)` or more tricky way.
 */
export function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  if (!value || typeof value !== 'object') {
    return false
  }

  const proto = Object.getPrototypeOf(value)

  return proto === Object.prototype || !proto || !proto.constructor
}

/**
 * Check if the value satisfy a `object` type in typescript
 */
export function isTypescriptObject(value: unknown): value is object & Record<PropertyKey, unknown> {
  return !!value && (typeof value === 'object' || typeof value === 'function')
}

export function clone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(clone) as any
  }

  if (isObject(value)) {
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

export function setOwn(object: object, key: PropertyKey, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(object, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    })
  }
  else {
    (object as Record<PropertyKey, unknown>)[key] = value
  }
}

export function copyOnWrite(parent: object, key: PropertyKey, original: unknown): unknown {
  const value = (parent as Record<PropertyKey, unknown>)[key]

  if (value !== original) {
    return value
  }

  let copy: object

  if (Array.isArray(value)) {
    copy = value.slice()
  }
  else if (isObject(value)) {
    copy = { ...value }
  }
  else {
    return value
  }

  setOwn(parent, key, copy)

  return copy
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
