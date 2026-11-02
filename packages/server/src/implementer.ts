import type { RouterContract } from '@orpc/contract'
import type { AnyFunction } from '@orpc/shared'
import type { BuilderConfig, DefaultInitialContext } from './builder'
import type { Context } from './context'
import type { RouterImplementer } from './implementer-router'
import type { ProcedureConfig } from './procedure'
import { isTypescriptObject } from '@orpc/shared'
import { createRouterImplementer } from './implementer-router'

/**
 * Configuration of `implement`: the procedure configuration,
 * plus options only read when the implementer augments a router with `.router` or `.lazy`.
 */
export interface ImplementerConfig extends ProcedureConfig, Pick<BuilderConfig, 'dedupeLeadingMiddlewares'> {
}

export type Implementer<
  TContract extends RouterContract,
  TInitialContext extends Context,
>
  = & {
    $context<T extends Context = DefaultInitialContext>(): Implementer<TContract, T & object>
    $config(config: ImplementerConfig): Implementer<TContract, TInitialContext>
  }
  & RouterImplementer<TContract, TInitialContext>

/**
 * Turns a contract into an implementer, used to implement the contract's
 * procedures, routers, and middleware with full type safety.
 *
 * @see {@link https://orpc.dev/docs/contract/implementation#implementer | Contract Implementation - Implementer}
 */
export function implement<TContract extends RouterContract, TInitialContext extends Context = DefaultInitialContext>(
  contract: TContract,
  config: ImplementerConfig = {},
): Implementer<TContract, TInitialContext & object> {
  // Using `& object` avoids "has no properties in common with type" errors
  // when combining procedures or routers with compatible but non-overlapping contexts.

  const routerImplementer = createRouterImplementer(contract, config)

  const implementer = new Proxy(routerImplementer, {
    get(_, p) {
      let method: undefined | AnyFunction
      if (p === '$context') {
        method = () => implementer
      }
      else if (p === '$config') {
        method = (incoming: ImplementerConfig) => implement(contract, { ...config, ...incoming })
      }

      const value = Reflect.get(routerImplementer, p)

      if (method) {
        if (!isTypescriptObject(value)) {
          return method
        }

        return new Proxy(method, {
          get(_, p) {
            return Reflect.get(value, p)
          },
        })
      }

      return value
    },
  })

  return implementer as any
}
