const REGEXP_FLAGS = /^[dgimsuvy]*$/

/**
 * Checks whether `flags` is a valid RegExp flags string without compiling a RegExp.
 */
export function isValidRegExpFlags(flags: string): boolean {
  return REGEXP_FLAGS.test(flags)
    && new Set(flags).size === flags.length
    && !(flags.includes('u') && flags.includes('v'))
}

/**
 * Creates a RegExp that is only compiled on first use.
 *
 * Compiling a RegExp can be expensive (unicode property escapes cost milliseconds each),
 * and the source comes from the wire. Deferring the compile means a request that is
 * rejected before the value is touched, for example by an auth middleware, never pays for it.
 *
 * The returned value passes `instanceof RegExp` and forwards every property access and
 * method call to the compiled RegExp. A syntax error in `pattern` is thrown on first use,
 * not here.
 */
export function createLazyRegExp(pattern: string, flags: string): RegExp {
  let compiled: RegExp | undefined

  const compile = (): RegExp => compiled ??= new RegExp(pattern, flags)

  /**
   * The placeholder target only supplies the prototype (so `instanceof RegExp` holds)
   * and default own-property shape; every read and write goes to the compiled RegExp.
   */
  return new Proxy(/^/, {
    get(_, prop) {
      if (prop === Symbol.toStringTag) {
        return 'RegExp'
      }

      const target = compile()
      const value = Reflect.get(target, prop, target)

      return typeof value === 'function' ? value.bind(target) : value
    },
    set(_, prop, value) {
      const target = compile()
      return Reflect.set(target, prop, value, target)
    },
    has(_, prop) {
      return Reflect.has(compile(), prop)
    },
  })
}
