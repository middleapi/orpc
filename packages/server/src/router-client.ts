import type { ClientContext } from '@orpc/client'
import type { ErrorMap, Schema } from '@orpc/contract'
import type { MaybeOptionalOptions } from '@orpc/shared'
import type { Lazyable } from './lazy'
import type { ProcedureClient, ProcedureClientOptions } from './procedure-client'
import type { AnyRouter, InferRouterInitialContext } from './router'
import { RECURSIVE_CLIENT_UNWRAP_KEYS } from '@orpc/client'
import { getOrBind, resolveMaybeOptionalOptions, toArray } from '@orpc/shared'
import { Lazy } from './lazy'
import { Procedure } from './procedure'
import { createProcedureClient } from './procedure-client'
import { createGuardedProcedureLazy } from './procedure-utils'
import { getRouter } from './router-utils'

export type RouterClient<TRouter extends AnyRouter, TClientContext extends ClientContext = object>
  = TRouter extends Procedure<any, any, infer $InputSchema, infer $OutputSchema, infer $ErrorMap, infer $ReturnedError>
    ? ProcedureClient<TClientContext, $InputSchema, $OutputSchema, $ErrorMap, $ReturnedError>
    : {
        [K in keyof TRouter]: TRouter[K] extends Lazyable<infer U extends AnyRouter> ? RouterClient<U, TClientContext> : never
      }

export function createRouterClient<T extends AnyRouter, TClientContext extends ClientContext = object>(
  router: Lazyable<T | undefined>,
  ...rest: MaybeOptionalOptions<
    ProcedureClientOptions<
      InferRouterInitialContext<T>,
      Schema<unknown>,
      ErrorMap,
      any,
      TClientContext
    >
  >
): RouterClient<T, TClientContext> {
  const options = resolveMaybeOptionalOptions(rest)

  if (router instanceof Procedure) {
    return createProcedureClient(router, options) as any
  }

  const procedureCaller = router instanceof Lazy
    ? createProcedureClient(createGuardedProcedureLazy(router), options)
    : {}

  const recursive = new Proxy(procedureCaller, {
    get(target, key) {
      if (typeof key !== 'string' || (router instanceof Lazy && RECURSIVE_CLIENT_UNWRAP_KEYS.has(key))) {
        return getOrBind(target, key)
      }

      const next = getRouter(router, [key])

      if (!next) {
        return getOrBind(target, key)
      }

      const nextClient = createRouterClient(next as any, {
        ...options,
        path: [...toArray(options.path), key],
      })

      return nextClient
    },
  })

  return recursive as any
}
