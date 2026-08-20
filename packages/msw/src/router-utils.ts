import type { RouterContract } from '@orpc/contract'
import type { Context } from '@orpc/server'
import type { Public } from '@orpc/shared'
import type { ProcedureUtilsOptions } from './procedure-utils'
import { ProcedureContract } from '@orpc/contract'
import { Lazy } from '@orpc/server'
import { bindMethods } from '@orpc/shared'
import { ProcedureUtils } from './procedure-utils'

/**
 * The utils shape derived from a router-contract: procedure-contracts map to
 * procedure utils, and nested routers map recursively to nested utils.
 *
 * @see {@link https://orpc.dev/docs/integrations/msw | MSW Integration}
 */
export type RouterUtils<T extends RouterContract, TContext extends Context = Record<never, never>>
  = T extends ProcedureContract<infer UInputSchema, infer UOutputSchema, infer UErrorMap>
    ? Public<ProcedureUtils<TContext, UInputSchema, UOutputSchema, UErrorMap>>
    : {
        [K in keyof T]: T[K] extends RouterContract ? RouterUtils<T[K], TContext> : never
      }

/**
 * Options for creating MSW router utils.
 *
 * @see {@link https://orpc.dev/docs/integrations/msw | MSW Integration}
 */
export interface RouterUtilsOptions<TContext extends Context> extends ProcedureUtilsOptions<TContext> {}

/**
 * Creates MSW utils from a router-contract (or an implemented router),
 * exposing typed MSW request handler builders for every procedure, served
 * through the fetch handler created by the `handler` option.
 *
 * @see {@link https://orpc.dev/docs/integrations/msw | MSW Integration}
 */
export function createRouterUtils<T extends RouterContract, TContext extends Context = Record<never, never>>(
  contract: T,
  options: RouterUtilsOptions<TContext>,
): RouterUtils<T, TContext> {
  return createRouterUtilsInternal(contract, options, []) as RouterUtils<T, TContext>
}

function createRouterUtilsInternal(
  contract: RouterContract,
  options: RouterUtilsOptions<any>,
  path: readonly string[],
): unknown {
  if (contract instanceof ProcedureContract) {
    return bindMethods(new ProcedureUtils(contract, path, options))
  }

  if (contract instanceof Lazy) {
    throw new TypeError(
      `Lazy routers are not supported at path: "${path.join('.')}". Please convert the router with unlazyRouter before creating MSW utils.`,
    )
  }

  const utils: Record<string, unknown> = {}

  for (const key in contract) {
    utils[key] = createRouterUtilsInternal(contract[key] as RouterContract, options, [...path, key])
  }

  return utils
}
