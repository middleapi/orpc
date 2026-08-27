import type { ErrorMap, Schema } from '@orpc/contract'
import type { StandardHandlerOptions, StandardHandlerPlugin } from '../adapters/standard'
import type { Context } from '../context'
import type { ProcedureClientInterceptor } from '../procedure-client'
import { ORPCError } from '@orpc/client'
import { isPlainObject, isTypescriptObject, toArray } from '@orpc/shared'

/**
 * Rejects requests whose decoded input contains prototype-polluting keys: an own
 * `__proto__` key, or an own `constructor` key holding a `prototype` key. oRPC's own
 * decoding never assigns through the prototype chain, so this plugin exists to stop such
 * keys from reaching application code that merges, clones, or path-sets input with a
 * library vulnerable to prototype pollution.
 *
 * @remarks
 * **Note**: Only the decoded request input is inspected. Values yielded later by an
 * [event iterator](https://orpc.dev/docs/async-iterator-object) input arrive after this
 * check runs, so they pass through uninspected.
 *
 * @see {@link https://orpc.dev/docs/plugins/prototype-pollution-protection | Prototype Pollution Protection Plugin}
 */
export class PrototypePollutionProtectionHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~prototype-pollution-protection'

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const interceptor: ProcedureClientInterceptor<T, Schema<unknown>, ErrorMap, any> = (interceptorOptions) => {
      if (this.containsPollutingKey(interceptorOptions.input)) {
        throw new ORPCError('BAD_REQUEST', { message: 'Request blocked by prototype pollution protection.' })
      }

      return interceptorOptions.next()
    }

    return {
      ...options,
      clientInterceptors: [interceptor, ...toArray(options.clientInterceptors)],
    }
  }

  /**
   * Walks the containers the built-in codecs can produce: arrays, maps, sets, and plain
   * objects, including null-prototype ones. Other objects, such as files and dates, carry
   * no attacker-authored keys and are left alone.
   */
  private containsPollutingKey(value: unknown, visited = new WeakSet<object>()): boolean {
    if (typeof value !== 'object' || value === null || visited.has(value)) {
      return false
    }

    visited.add(value)

    if (Array.isArray(value)) {
      return value.some(item => this.containsPollutingKey(item, visited))
    }

    // A map yields `[key, item]` entry arrays, so recursing covers both keys and values.
    if (value instanceof Map || value instanceof Set) {
      for (const entry of value) {
        if (this.containsPollutingKey(entry, visited)) {
          return true
        }
      }

      return false
    }

    if (!isPlainObject(value)) {
      return false
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

    return Object.keys(value).some(key => this.containsPollutingKey(value[key], visited))
  }
}
