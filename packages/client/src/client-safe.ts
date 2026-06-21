import type { AnyNestedClient, Client, ClientRest } from './types'
import type { SafeResult } from './utils'
import { getOrBind, isTypescriptObject } from '@orpc/shared'
import { safe } from './utils'

export type SafeClient<T extends AnyNestedClient>
  = T extends Client<infer UContext, infer UInput, infer UOutput, infer UError>
    ? (...rest: ClientRest<UContext, UInput>) => Promise<SafeResult<UOutput, UError>>
    : {
        [K in keyof T]: T[K] extends AnyNestedClient ? SafeClient<T[K]> : never
      }

/**
 * Create a safe client that automatically wraps all procedure calls with the `safe` util.
 *
 * @example
 * ```ts
 * const safeClient = createSafeClient(client)
 * const { error, data, inferrableError, isSuccess } = await safeClient.doSomething({ id: '123' })
 * // or const [error, data, inferrableError, isSuccess] = await safeClient.doSomething({ id: '123' })
 * ```
 *
 * @see {@link https://orpc.dev/docs/client/error-handling#using-createsafeclient Safe Client Docs}
 */
export function createSafeClient<T extends AnyNestedClient>(client: T): SafeClient<T> {
  const proxy = new Proxy((...args: any[]) => safe((client as any)(...args)), {
    get(_, prop) {
      const value = getOrBind(client, prop)

      if (!isTypescriptObject(value)) {
        return value
      }

      return createSafeClient(value as AnyNestedClient)
    },
  })

  return proxy as SafeClient<T>
}
