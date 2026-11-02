import type { RouterContract } from '@orpc/contract'
import type { Lazyable } from './lazy'
import type { AnyRouter } from './router'
import { ProcedureContract } from '@orpc/contract'
import { isTypescriptObject, omit } from '@orpc/shared'
import { Procedure } from './procedure'

const HIDDEN_ROUTER_CONTRACT_SYMBOL = /* @__PURE__ */ Symbol.for('ORPC_HIDDEN_ROUTER_CONTRACT')

/**
 * A normal router can be used as a contract, but its procedures carry implementation details
 * (handler, middlewares, config). Handlers serve the hidden contract and treat any procedure as
 * the implementation, so the contract's procedures would run instead of the actual implementation.
 *
 * Rebuilds the contract with every procedure stripped down to a plain {@link ProcedureContract},
 * copying only the routers that contain one, so contract-first contracts are returned as is.
 */
function toPlainRouterContract<T>(contract: T): T {
  if (!isTypescriptObject(contract)) {
    return contract
  }

  if (contract instanceof ProcedureContract) {
    if (!(contract instanceof Procedure)) {
      return contract
    }

    // handler & orderedMiddlewares are what make a definition a procedure (see Procedure[Symbol.hasInstance])
    return new ProcedureContract(omit(contract['~orpc'], ['handler', 'orderedMiddlewares'])) as T
  }

  let copied: Record<string, unknown> | undefined

  for (const key of Object.keys(contract)) {
    const child = (contract as Record<string, unknown>)[key]
    const plainChild = toPlainRouterContract(child)

    if (plainChild !== child) {
      copied ??= { ...contract }
      copied[key] = plainChild
    }
  }

  return (copied ?? contract) as T
}

export function withHiddenRouterContract<T extends Lazyable<AnyRouter>>(router: T, contract: RouterContract): T {
  const plainContract = toPlainRouterContract(contract)

  return new Proxy(router, {
    get(target, key) {
      if (key === HIDDEN_ROUTER_CONTRACT_SYMBOL) {
        return plainContract
      }

      return Reflect.get(target, key)
    },
  })
}

export function getHiddenRouterContract(router: Lazyable<AnyRouter | RouterContract>): RouterContract | undefined {
  return (router as any)[HIDDEN_ROUTER_CONTRACT_SYMBOL]
}
