import type { RouterContract } from '@orpc/contract'
import { isNonPrimitive } from '@orpc/shared'

import type { Lazyable } from './lazy'
import type { AnyRouter } from './router'

const HIDDEN_ROUTER_CONTRACT_SYMBOL = /* @__PURE__ */ Symbol.for('ORPC_HIDDEN_ROUTER_CONTRACT')

export function withHiddenRouterContract<T extends Lazyable<AnyRouter>>(
  router: T,
  contract: RouterContract,
): T {
  return new Proxy(router, {
    get(target, key) {
      if (key === HIDDEN_ROUTER_CONTRACT_SYMBOL) {
        return contract
      }

      return Reflect.get(target, key)
    },
  })
}

export function getHiddenRouterContract(router: unknown): RouterContract | undefined {
  if (!isNonPrimitive(router)) {
    return undefined
  }

  return router[HIDDEN_ROUTER_CONTRACT_SYMBOL] as RouterContract | undefined
}
