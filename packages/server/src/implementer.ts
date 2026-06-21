import type { RouterContract } from '@orpc/contract'
import type { DefaultInitialContext } from './builder'
import type { Context } from './context'
import type { RouterImplementer } from './implementer-router'
import { getOrBind, isTypescriptObject } from '@orpc/shared'
import { createRouterImplementer } from './implementer-router'

export type Implementer<
  TContract extends RouterContract,
  TInitialContext extends Context,
>
  = & {
    $context<T extends Context = DefaultInitialContext>(): Implementer<TContract, T & object>
  }
  & RouterImplementer<TContract, TInitialContext>

export function implement<TContract extends RouterContract, TInitialContext extends Context = DefaultInitialContext>(
  contract: TContract,
): Implementer<TContract, TInitialContext & object> {
  // Using `& object` avoids "has no properties in common with type" errors
  // when combining procedures or routers with compatible but non-overlapping contexts.

  const routerImplementer = createRouterImplementer(contract)

  const implementer = new Proxy(routerImplementer, {
    get(_, p) {
      let method: undefined | (() => any)
      if (p === '$context') {
        method = () => implementer
      }

      const value = getOrBind(routerImplementer, p)

      if (method) {
        if (!isTypescriptObject(value)) {
          return method
        }

        return new Proxy(method, {
          get(_, p) {
            return getOrBind(value, p)
          },
        })
      }

      return value
    },
  })

  return implementer as any
}
