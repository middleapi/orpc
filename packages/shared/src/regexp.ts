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
 *
 * Reads that a fresh RegExp could answer without its pattern never compile: `lastIndex`
 * (0 until written), and properties that do not exist on a RegExp such as `then`, `toJSON`
 * or inspection symbols. So awaiting, `JSON.stringify` and logging the value are free.
 *
 * Known differences from a native RegExp: it has no own properties
 * (`Object.hasOwn(value, 'lastIndex')` is false), `Object.freeze` is not supported,
 * `structuredClone` rejects it, and Node's `util.types.isRegExp` returns false.
 */
export function createLazyRegExp(pattern: string, flags: string): RegExp {
  let compiled: RegExp | undefined
  let lastIndex: unknown = 0

  const compile = (): RegExp => {
    if (compiled === undefined) {
      compiled = new RegExp(pattern, flags)
      compiled.lastIndex = lastIndex as number
    }

    return compiled
  }

  /**
   * The target has no own properties, so nothing can be read through it by
   * `Object.hasOwn` style checks; it only supplies the prototype for `instanceof`.
   */
  return new Proxy(Object.create(RegExp.prototype) as RegExp, {
    get(_, prop) {
      if (prop === Symbol.toStringTag) {
        return 'RegExp'
      }

      if (compiled === undefined) {
        if (prop === 'lastIndex') {
          return lastIndex
        }

        if (!(prop in RegExp.prototype)) {
          return undefined
        }
      }

      const target = compile()
      const value = Reflect.get(target, prop, target)

      return typeof value === 'function' && prop !== 'constructor' ? value.bind(target) : value
    },
    set(_, prop, value) {
      if (compiled === undefined && prop === 'lastIndex') {
        lastIndex = value
        return true
      }

      const target = compile()
      return Reflect.set(target, prop, value, target)
    },
    has(_, prop) {
      if (compiled === undefined) {
        return prop === 'lastIndex' || prop in RegExp.prototype
      }

      return Reflect.has(compiled, prop)
    },
  })
}
