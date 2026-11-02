import type { RouterContract } from '@orpc/contract'
import type { AnyFunction } from '@orpc/shared'
import type { DefaultInitialContext } from './builder'
import type { Context } from './context'
import type { RouterImplementer } from './implementer-router'
import type { ProcedureConfig } from './procedure'
import { ProcedureContract } from '@orpc/contract'
import { isTypescriptObject } from '@orpc/shared'
import { createRouterImplementer } from './implementer-router'
import { Procedure } from './procedure'

export type Implementer<
  TContract extends RouterContract,
  TInitialContext extends Context,
>
  = & {
    $context<T extends Context = DefaultInitialContext>(): Implementer<TContract, T & object>
    $config(config: ProcedureConfig): Implementer<TContract, TInitialContext>
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
  config: ProcedureConfig = {},
): Implementer<TContract, TInitialContext & object> {
  // Using `& object` avoids "has no properties in common with type" errors
  // when combining procedures or routers with compatible but non-overlapping contexts.

  return createImplementer(toPlainRouterContract(contract), config)
}

function createImplementer(contract: RouterContract, config: ProcedureConfig): any {
  const routerImplementer = createRouterImplementer(contract, config)

  const implementer = new Proxy(routerImplementer, {
    get(_, p) {
      let method: undefined | AnyFunction
      if (p === '$context') {
        method = () => implementer
      }
      else if (p === '$config') {
        method = (incoming: ProcedureConfig) => createImplementer(contract, { ...config, ...incoming })
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

  return implementer
}

/**
 * A normal router can be used as a contract, but its procedures carry implementation details
 * (handler, middlewares, config) that must never leak into the implementation: handlers serve
 * the hidden contract attached by `.router()`, so they would run the contract's procedures instead.
 *
 * Rebuilds the contract with every procedure stripped down to a plain {@link ProcedureContract},
 * copying only the routers that contain one, so contract-first contracts are returned as is.
 */
function toPlainRouterContract<T>(contract: T): T {
  if (contract instanceof ProcedureContract) {
    if (!(contract instanceof Procedure)) {
      return contract
    }

    const { inputSchemas, outputSchemas, metaPlugins, errorMap, meta } = contract['~orpc']

    return new ProcedureContract({ inputSchemas, outputSchemas, metaPlugins, errorMap, meta }) as T
  }

  if (!isTypescriptObject(contract)) {
    return contract
  }

  let stripped: Record<string, unknown> | undefined

  for (const key of Object.keys(contract)) {
    const child = contract[key]
    const strippedChild = toPlainRouterContract(child)

    if (strippedChild !== child) {
      stripped ??= { ...contract }
      stripped[key] = strippedChild
    }
  }

  return (stripped ?? contract) as T
}
