export function toArray<T>(
  value: T,
): T extends readonly any[] ? T : Exclude<T, undefined | null>[] {
  return (
    Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  ) as any
}

export function splitInHalf<T>(arr: readonly T[]): [T[], T[]] {
  const half = Math.ceil(arr.length / 2)
  return [arr.slice(0, half), arr.slice(half)]
}
