import type { ContractProcedure, ContractRouter, SchemaInput, SchemaOutput } from '@orpc/contract'
import type { Hooks, Value } from '@orpc/shared'
import type { Lazy } from './lazy'
import type { Procedure } from './procedure'
import type { ProcedureClient } from './procedure-client'
import type { Meta } from './types'
import { isLazy } from './lazy'
import { createLazyProcedureFormAnyLazy } from './lazy-utils'
import { isProcedure } from './procedure'
import { createProcedureClient } from './procedure-client'
import { type ANY_ROUTER, getRouterChild, type Router } from './router'

export type RouterClient<TRouter extends ANY_ROUTER | ContractRouter, TClientContext> =
TRouter extends Lazy<infer U extends ANY_ROUTER | ContractRouter>
  ? RouterClient<U, TClientContext>
  : TRouter extends
  | ContractProcedure<infer UInputSchema, infer UOutputSchema>
  | Procedure<any, any, infer UInputSchema, infer UOutputSchema, infer UFuncOutput>
    ? ProcedureClient<SchemaInput<UInputSchema>, SchemaOutput<UOutputSchema, UFuncOutput>, TClientContext>
    : {
        [K in keyof TRouter]: TRouter[K] extends ANY_ROUTER | ContractRouter ? RouterClient<TRouter[K], TClientContext> : never
      }

export type CreateRouterClientOptions<
  TRouter extends ANY_ROUTER,
> =
  & {
    router: TRouter | Lazy<undefined>

    /**
     * This is helpful for logging and analytics.
     *
     * @internal
     */
    path?: string[]
  }
  & (TRouter extends Router<infer UContext, any>
    ? undefined extends UContext ? { context?: Value<UContext> } : { context: Value<UContext> }
    : never)
  & Hooks<unknown, unknown, TRouter extends Router<infer UContext, any> ? UContext : never, Meta>

export function createRouterClient<
  TRouter extends ANY_ROUTER,
>(
  options: CreateRouterClientOptions<TRouter>,
): RouterClient<TRouter, unknown> {
  if (isProcedure(options.router)) {
    const caller = createProcedureClient({
      ...options,
      procedure: options.router,
      context: options.context,
      path: options.path,
    })

    return caller as any
  }

  const procedureCaller = isLazy(options.router)
    ? createProcedureClient({
        ...options,
        procedure: createLazyProcedureFormAnyLazy(options.router),
        context: options.context,
        path: options.path,
      })
    : {}

  const recursive = new Proxy(procedureCaller, {
    get(target, key) {
      if (typeof key !== 'string') {
        return Reflect.get(target, key)
      }

      const next = getRouterChild(options.router, key)

      if (!next) {
        return Reflect.get(target, key)
      }

      return createRouterClient({
        ...options,
        router: next,
        path: [...(options.path ?? []), key],
      })
    },
  })

  return recursive as any
}
