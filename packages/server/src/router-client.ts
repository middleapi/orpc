import type { ClientContext } from '@orpc/client'
import type { ErrorMap, Meta, Schema } from '@orpc/contract'
import type { MaybeOptionalOptions } from '@orpc/shared'
import type { Lazyable } from './lazy'
import type { Procedure } from './procedure'
import type { CreateProcedureClientOptions, ProcedureClient } from './procedure-client'
import type { AnyRouter, InferRouterInitialContext } from './router'
import { resolveMaybeOptionalOptions } from '@orpc/shared'
import { isLazy } from './lazy'
import { isProcedure } from './procedure'
import { createProcedureClient } from './procedure-client'
import { createAssertedLazyProcedure } from './procedure-utils'
import { getRouter } from './router-utils'

export type RouterClient<TRouter extends AnyRouter, TClientContext extends ClientContext = Record<never, never>>
  = TRouter extends Procedure<any, any, infer UInputSchema, infer UOutputSchema, infer UErrorMap, any>
    ? ProcedureClient<TClientContext, UInputSchema, UOutputSchema, UErrorMap>
    : {
        [K in keyof TRouter]: TRouter[K] extends Lazyable<infer U extends AnyRouter> ? RouterClient<U, TClientContext> : never
      }

/**
 * Create Server-side client from a router.
 *
 * @see {@link https://orpc.unnoq.com/docs/client/server-side Server-side Client Docs}
 */
export function createRouterClient<T extends AnyRouter, TClientContext extends ClientContext>(
  router: Lazyable<T | undefined>,
  ...rest: MaybeOptionalOptions<
    CreateProcedureClientOptions<
      InferRouterInitialContext<T>,
      Schema<unknown, unknown>,
      ErrorMap,
      Meta,
      TClientContext
    >
  >
): RouterClient<T, TClientContext> {
  if (isProcedure(router)) {
    const caller = createProcedureClient(router, resolveMaybeOptionalOptions(rest))

    return caller as any
  }

  const procedureCaller = isLazy(router)
    ? createProcedureClient(createAssertedLazyProcedure(router), resolveMaybeOptionalOptions(rest))
    : {}

  const recursive = new Proxy(procedureCaller, {
    get(target, key) {
      if (typeof key !== 'string') {
        return Reflect.get(target, key)
      }

      const next = getRouter(router, [key])

      if (!next) {
        return Reflect.get(target, key)
      }

      return createRouterClient(next, {
        ...rest[0],
        path: [...(rest[0]?.path ?? []), key],
      } as any)
    },
  })

  return recursive as any
}
