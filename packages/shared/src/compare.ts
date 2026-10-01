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

  // Values like Date or Map keep their state in internal slots and would look like empty objects,
  // so compare their kind first. Unlike `instanceof`, the tag also works across realms.
  const tag = Object.prototype.toString.call(a)

  if (tag !== Object.prototype.toString.call(b)) {
    return false
  }

  if (tag === '[object Date]') {
    return Object.is((a as Date).getTime(), (b as Date).getTime())
  }

  if (tag === '[object RegExp]') {
    return (a as RegExp).source === (b as RegExp).source && (a as RegExp).flags === (b as RegExp).flags
  }

  if (tag === '[object Array]' && (a as unknown[]).length !== (b as unknown[]).length) {
    return false
  }

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
  if (tag === '[object Map]') {
    const aMap = a as Map<unknown, unknown>
    const bMap = b as Map<unknown, unknown>

    if (aMap.size !== bMap.size) {
      return false
    }

    for (const [key, value] of aMap) {
      if (!bMap.has(key) || !isDeepEqualInternal(value, bMap.get(key), visited)) {
        return false
      }
    }

    return true
  }

  if (tag === '[object Set]') {
    const aSet = a as Set<unknown>
    const bSet = b as Set<unknown>

    if (aSet.size !== bSet.size) {
      return false
    }

    for (const value of aSet) {
      if (!bSet.has(value)) {
        return false
      }
    }

    return true
  }

  const aRecord = a as Record<string, unknown>
  const bRecord = b as Record<string, unknown>

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
