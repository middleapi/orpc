export function isDeepEqual(a: unknown, b: unknown): boolean {
  return isDeepEqualInternal(a, b, new WeakMap())
}

function isDeepEqualInternal(
  a: unknown,
  b: unknown,
  visited: WeakMap<object, WeakSet<object>>,
): boolean {
  // `===` treats 0 and -0 as equal, `Object.is` treats NaN as equal to itself
  if (a === b || Object.is(a, b)) {
    return true
  }

  if (typeof a !== typeof b) {
    return false
  }

  if (a === null || typeof a !== 'object') {
    return false
  }

  if (b === null || typeof b !== 'object') {
    return false
  }

  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && Object.is(a.getTime(), b.getTime())
  }

  if (a instanceof RegExp || b instanceof RegExp) {
    return a instanceof RegExp && b instanceof RegExp && a.source === b.source && a.flags === b.flags
  }

  const isArray = Array.isArray(a)

  if (isArray !== Array.isArray(b)) {
    return false
  }

  if (isArray && a.length !== (b as unknown[]).length) {
    return false
  }

  const aRecord = a as Record<string, unknown>
  const bRecord = b as Record<string, unknown>

  const visitedMatches = visited.get(a)

  if (visitedMatches?.has(b)) {
    return true
  }

  if (visitedMatches) {
    visitedMatches.add(b)
  }
  else {
    visited.set(a, new WeakSet([b]))
  }

  // Map keys and Set members are matched by identity (SameValueZero), like `Map#has`
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) {
      return false
    }

    for (const [key, value] of a) {
      if (!b.has(key) || !isDeepEqualInternal(value, b.get(key), visited)) {
        return false
      }
    }

    return true
  }

  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) {
      return false
    }

    for (const value of a) {
      if (!b.has(value)) {
        return false
      }
    }

    return true
  }

  const aKeys = Object.keys(aRecord).filter(k => aRecord[k] !== undefined)
  const bKeys = Object.keys(bRecord).filter(k => bRecord[k] !== undefined)

  if (aKeys.length !== bKeys.length) {
    return false
  }

  for (const key of aKeys) {
    if (!Object.hasOwn(bRecord, key)) {
      return false
    }

    if (!isDeepEqualInternal(aRecord[key], bRecord[key], visited)) {
      return false
    }
  }

  return true
}
