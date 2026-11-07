export function toArray<T>(
  value: T,
): T extends readonly any[] ? T : Exclude<T, undefined | null>[] {
  return (
    Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  ) as any
}

/**
 * Keeps only the last `maxSize` items, returning `items` itself when it already fits.
 */
export function limitArraySize<T>(items: T[], maxSize: number): T[] {
  if (items.length <= maxSize) {
    return items
  }

  return items.slice(items.length - maxSize)
}

export function splitInHalf<T>(arr: readonly T[]): [T[], T[]] {
  const half = Math.ceil(arr.length / 2)
  return [arr.slice(0, half), arr.slice(half)]
}
