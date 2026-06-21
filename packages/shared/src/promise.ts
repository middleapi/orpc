/**
 * Creates a promise together with its associated `resolve` and `reject`
 * functions.
 *
 * Equivalent to `Promise.withResolvers()`, but works in environments
 * where that API is not yet available.
 */
export function promiseWithResolvers<T>(): {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (reason: unknown) => void
} {
  const result: {
    promise?: Promise<T>
    resolve?: (v: T) => void
    reject?: (reason: unknown) => void
  } = {}

  result.promise = new Promise((resolve, reject) => {
    result.resolve = resolve
    result.reject = reject
  })

  return result as Required<typeof result>
}
