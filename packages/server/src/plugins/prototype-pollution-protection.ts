import type { ErrorMap, Schema } from '@orpc/contract'
import type { StandardHandlerOptions, StandardHandlerPlugin } from '../adapters/standard'
import type { Context } from '../context'
import type { ProcedureClientInterceptor } from '../procedure-client'
import { ORPCError } from '@orpc/client'
import { isAsyncIteratorObject, isPlainObject, isTypescriptObject, override, toArray, wrapAsyncIterator } from '@orpc/shared'

/**
 * Rejects requests whose decoded input contains prototype-polluting keys: an own
 * `__proto__` key, or an own `constructor` key holding a `prototype` key. oRPC's own
 * decoding never assigns through the prototype chain, so this plugin exists to stop such
 * keys from reaching application code that merges, clones, or path-sets input with a
 * library vulnerable to prototype pollution. An `AsyncIteratorObject` input is checked
 * value by value as it arrives, and a polluting value fails that iteration instead.
 *
 * @see {@link https://orpc.dev/docs/plugins/prototype-pollution-protection | Prototype Pollution Protection Plugin}
 */
export class PrototypePollutionProtectionHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~prototype-pollution-protection'

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const interceptor: ProcedureClientInterceptor<T, Schema<unknown>, ErrorMap, any> = (interceptorOptions) => {
      const input = interceptorOptions.input

      if (isAsyncIteratorObject(input)) {
        /**
         * @warning
         * Remember use `override` for AsyncIteratorObject to remain other special properties
         */
        const guardedInput = override(input, wrapAsyncIterator(input, {
          mapResult: (result) => {
            this.rejectPollutingInput(result.value)
            return result
          },
        }))

        return interceptorOptions.next({ ...interceptorOptions, input: guardedInput })
      }

      this.rejectPollutingInput(input)

      return interceptorOptions.next()
    }

    return {
      ...options,
      clientInterceptors: [interceptor, ...toArray(options.clientInterceptors)],
    }
  }

  private rejectPollutingInput(input: unknown): void {
    if (this.containsPollutingKey(input)) {
      throw new ORPCError('BAD_REQUEST', { message: 'Request blocked by prototype pollution protection.' })
    }
  }

  /**
   * Walks the containers the built-in codecs can produce: arrays, maps, sets, and plain
   * objects, including null-prototype ones. Other objects, such as files and dates, carry
   * no attacker-authored keys and are left alone. The walk is iterative, so input nested
   * deeper than the call stack allows still gets the intended verdict instead of a
   * `RangeError`.
   */
  private containsPollutingKey(root: unknown): boolean {
    const visited = new WeakSet<object>()
    const stack = [root]

    while (stack.length !== 0) {
      const value = stack.pop()

      if (typeof value !== 'object' || value === null || visited.has(value)) {
        continue
      }

      visited.add(value)

      if (Array.isArray(value)) {
        for (const item of value) {
          stack.push(item)
        }

        continue
      }

      // A map yields `[key, item]` entry arrays, so walking them covers both keys and values.
      if (value instanceof Map || value instanceof Set) {
        for (const entry of value) {
          stack.push(entry)
        }

        continue
      }

      if (!isPlainObject(value)) {
        continue
      }

      if (Object.hasOwn(value, '__proto__')) {
        return true
      }

      // A lone `constructor` key is harmless and common, such as user text. Pollution
      // requires reaching `constructor.prototype`, mirroring secure-json-parse.
      if (
        Object.hasOwn(value, 'constructor')
        && isTypescriptObject(value.constructor)
        && Object.hasOwn(value.constructor, 'prototype')
      ) {
        return true
      }

      for (const key of Object.keys(value)) {
        stack.push(value[key])
      }
    }

    return false
  }
}
