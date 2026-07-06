export function logError(error: unknown): void {
  if (typeof console === 'object' && typeof console.error === 'function') {
    console.error(error)
  }
}
