/**
 * Extracts valid enum values from an object, particularly TypeScript native enums.
 * Early-returns arrays for array-backed enums, and filters out reverse numeric mappings.
 *
 * @param obj - The enum object or array to extract values from.
 * @returns An array of valid enum values.
 */
export function getValidEnumValues(obj: any): any[] {
  if (Array.isArray(obj))
    return obj

  const validKeys = Object.keys(obj).filter(
    (k: any) => typeof obj[obj[k]] !== 'number',
  )
  const filtered: any = {}
  for (const k of validKeys) {
    filtered[k] = obj[k]
  }
  return Object.values(filtered)
}
