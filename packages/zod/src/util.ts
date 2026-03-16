export function getValidEnumValues(obj: any): any[] {
  const validKeys = Object.keys(obj).filter(
    (k: any) => typeof obj[obj[k]] !== 'number',
  )
  const filtered: any = {}
  for (const k of validKeys) {
    filtered[k] = obj[k]
  }
  return Object.values(filtered)
}
