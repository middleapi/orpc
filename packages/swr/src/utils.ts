import { isPlainObject } from '@orpc/shared'

/**
 * Checks whether `subsetKey` partially matches `fullKey`.
 *
 * Keys are compared in their serialized (JSON-compatible) form, as produced by `generateOperationKey`,
 * so values like `Date`, `BigInt`, `Set` and `Map` match by value.
 */
export function isSubsetOf(subsetKey: unknown, fullKey: unknown): boolean {
  return subsetKey === fullKey
    ? true
    : typeof subsetKey !== typeof fullKey
      ? false
      : isPlainObject(subsetKey) && isPlainObject(fullKey)
        ? Object.keys(subsetKey).every(key => subsetKey[key] === undefined || isSubsetOf(subsetKey[key], fullKey[key]))
        : Array.isArray(subsetKey) && Array.isArray(fullKey)
          ? subsetKey.every((value, index) => isSubsetOf(value, fullKey[index]))
          : false
}
