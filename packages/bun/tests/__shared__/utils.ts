export async function waitFor(fn: () => void, { timeout = 1000, interval = 50 } = {}) {
  const deadline = Date.now() + timeout
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      await fn()
      return
    }
    catch (e) {
      lastError = e
      await Bun.sleep(interval)
    }
  }
  throw lastError
}

/**
 * Wraps a client so `method` still issues its underlying call immediately but
 * only resolves once `release` is called. Await `read` to know the first held
 * call has completed, then run a racing operation before `release` to land it
 * between that read and whatever follows it.
 */
export function holdResult<T extends object>(client: T, method: keyof T & string): { client: T, read: Promise<void>, release: () => void } {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })

  let settle!: () => void
  const read = new Promise<void>((resolve) => {
    settle = resolve
  })

  const proxy = new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop)

      if (typeof value !== 'function') {
        return value
      }

      if (prop !== method) {
        return value.bind(target)
      }

      return async (...args: unknown[]) => {
        const result = await value.apply(target, args)
        settle()
        await gate
        return result
      }
    },
  })

  return { client: proxy, read, release }
}
