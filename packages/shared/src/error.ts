/**
 * Whether the value is an `Error`, including one created in another realm
 * (e.g. `node:vm` or an iframe), which fails `instanceof Error`.
 */
export function isErrorLike(value: unknown): value is Error {
  return value instanceof Error || Object.prototype.toString.call(value) === '[object Error]'
}

export function isAbortError(error: unknown): error is Error {
  return isErrorLike(error) && typeof error.name === 'string' && error.name.includes('Abort')
}
