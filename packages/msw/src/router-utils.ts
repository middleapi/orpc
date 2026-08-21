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
export type RouterUtilsOptions<TContext extends Context> = ProcedureUtilsOptions<TContext>

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
): RouterUtils<T, 0 extends 1 & TContext ? Record<never, never> : TContext> {
  // `0 extends 1 & TContext` detects `any`, which is inferred when the
  // `handler` option creates a handler without an explicit context type,
  // and falls back to the default context instead.
  return createRouterUtilsInternal(contract, options, []) as any
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
