/**
 * Like `instanceof Error`, but also accepts errors from another realm (e.g. `node:vm`, iframes).
 */
export function isErrorLike(value: unknown): value is Error {
  return value instanceof Error || Object.prototype.toString.call(value) === '[object Error]'
}

export function isAbortError(error: unknown): error is Error {
  return isErrorLike(error) && typeof error.name === 'string' && error.name.includes('Abort')
}
