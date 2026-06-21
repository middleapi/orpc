export type AnyFunction = (...args: any[]) => any

export function once<T>(fn: () => T): () => T {
  let cached: { result: T } | undefined

  return (): T => {
    if (cached) {
      return cached.result
    }

    const result = fn()
    cached = { result }

    return result
  }
}

/**
 * Executes the callback function after the current call stack has been cleared.
 */
export function defer(callback: () => void): void {
  if (typeof setTimeout === 'function') {
    setTimeout(callback, 0)
  }
  else {
    Promise.resolve()
      .then(() => Promise.resolve()
        .then(() => Promise.resolve()
          .then(callback)))
  }
}

export function tryOrUndefined<T>(fn: () => T): undefined | T {
  try {
    return fn()
  }
  catch {
    return undefined
  }
}
