import type { RouterContract } from '@orpc/contract'
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
export type RouterUtils<T extends RouterContract>
  = T extends ProcedureContract<infer UInputSchema, infer UOutputSchema, infer UErrorMap>
    ? Public<ProcedureUtils<UInputSchema, UOutputSchema, UErrorMap>>
    : {
        [K in keyof T]: T[K] extends RouterContract ? RouterUtils<T[K]> : never
      }

/**
 * Options for creating MSW router utils.
 *
 * @see {@link https://orpc.dev/docs/integrations/msw | MSW Integration}
 */
export interface RouterUtilsOptions extends ProcedureUtilsOptions {}

/**
 * Creates MSW utils from a router-contract (or an implemented router),
 * exposing typed MSW request handler builders for every procedure.
 *
 * @see {@link https://orpc.dev/docs/integrations/msw | MSW Integration}
 */
export function createRouterUtils<T extends RouterContract>(
  contract: T,
  options: NoInfer<RouterUtilsOptions> = {},
): RouterUtils<T> {
  return createRouterUtilsInternal(contract, options, []) as RouterUtils<T>
}

function createRouterUtilsInternal(
  contract: RouterContract,
  options: RouterUtilsOptions,
  path: readonly string[],
): unknown {
  if (contract instanceof ProcedureContract) {
    return bindMethods(new ProcedureUtils(contract, path, options))
  }

  if (contract instanceof Lazy) {
    throw new TypeError(
      `Lazy routers are not supported at path: "${path.join('.')}". Please unlazy the router before creating MSW utils.`,
    )
  }

  const utils: Record<string, unknown> = {}

  for (const key in contract) {
    utils[key] = createRouterUtilsInternal(contract[key] as RouterContract, options, [...path, key])
  }

  return utils
}
