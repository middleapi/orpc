/**
 * Wraps a client so `method` still issues its underlying call immediately but
 * only resolves once `release` is called. Run a racing operation before
 * `release` to land it between that read and whatever follows it.
 */
export function holdResult<T extends object>(client: T, method: keyof T & string): { client: T, release: () => void } {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
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
        await gate
        return result
      }
    },
  })

  return { client: proxy, release }
}
