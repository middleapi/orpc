import type { Client, ClientRest, NestedClient } from './types'
import type { SafeResult } from './utils'
import { isTypescriptObject } from '@orpc/shared'
import { safe } from './utils'

export type SafeClient<T extends NestedClient<any>>
  = T extends Client<infer UContext, infer UInput, infer UOutput, infer UError>
    ? (...rest: ClientRest<UContext, UInput>) => Promise<SafeResult<UOutput, UError>>
    : {
        [K in keyof T]: T[K] extends NestedClient<any> ? SafeClient<T[K]> : never
      }

/**
 * Create a safe client that automatically wraps all procedure calls with the `safe` util.
 *
 * @example
 * ```ts
 * const safeClient = createSafeClient(client)
 * const { error, data, isDefined } = await safeClient.doSomething({ id: '123' })
 * ```
 *
 * @see {@link https://orpc.unnoq.com/docs/client/error-handling#using-createsafeclient Safe Client Docs}
 */
export function createSafeClient<T extends NestedClient<any>>(client: T): SafeClient<T> {
  const proxy = new Proxy((...args: any[]) => safe((client as any)(...args)), {
    get(_, prop, receiver) {
      const value = Reflect.get(client, prop, receiver)

      if (typeof prop !== 'string') {
        return value
      }

      if (!isTypescriptObject(value)) {
        return value
      }

      return createSafeClient(value as NestedClient<any>)
    },
  })

  return proxy as SafeClient<T>
}
