export function isDeepEqual(a: unknown, b: unknown): boolean {
  return isDeepEqualInternal(a, b, new WeakMap())
}

function isDeepEqualInternal(
  a: unknown,
  b: unknown,
  visited: WeakMap<object, WeakSet<object>>,
): boolean {
  if (Object.is(a, b)) {
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
