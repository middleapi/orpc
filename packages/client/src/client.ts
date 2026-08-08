import type { Client, ClientLink, FriendlyClientOptions, InferClientContext, NestedClient } from './types'
import { preventNativeAwait } from '@orpc/shared'
import { RECURSIVE_CLIENT_UNWRAP_KEYS } from './consts'
import { resolveFriendlyClientOptions } from './utils'

export interface createORPCClientOptions {
  /**
   * Use as base path for all procedure, useful when you only want to call a subset of the procedure.
   */
  path?: readonly string[]
}

/**
 * Create a oRPC client-side client from a link.
 *
 * @see {@link https://orpc.dev/docs/client/client-side Client-side Client Docs}
 */
export function createORPCClient<T extends NestedClient<any>>(
  link: ClientLink<InferClientContext<T>>,
  options: createORPCClientOptions = {},
): T {
  const path = options.path ?? []

  const procedureClient: Client<InferClientContext<T>, unknown, unknown, Error> = async (
    ...[input, options = {} as FriendlyClientOptions<InferClientContext<T>>]
  ) => {
    return await link.call(path, input, resolveFriendlyClientOptions(options))
  }

  const recursive = new Proxy(procedureClient, {
    get(target, key) {
      if (typeof key !== 'string' || RECURSIVE_CLIENT_UNWRAP_KEYS.has(key)) {
        return Reflect.get(target, key)
      }

      return createORPCClient(link, {
        ...options,
        path: [...path, key],
      })
    },
  })

  return preventNativeAwait(recursive) as any
}
