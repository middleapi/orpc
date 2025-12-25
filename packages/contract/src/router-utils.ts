import type { ErrorMap, MergedErrorMap } from './error'
import type { AnyContractProcedure } from './procedure'
import type { EnhanceRouteOptions } from './route'
import type { AnyContractRouter } from './router'
import { toHttpPath } from '@orpc/client/standard'
import { toArray } from '@orpc/shared'
import { mergeErrorMap } from './error'
import { ContractProcedure, isContractProcedure } from './procedure'
import { enhanceRoute } from './route'

export function getContractRouter(router: AnyContractRouter, path: readonly string[]): AnyContractRouter | undefined {
  let current: AnyContractRouter | undefined = router

  for (let i = 0; i < path.length; i++) {
    const segment = path[i]!

    if (!current) {
      return undefined
    }

    if (isContractProcedure(current)) {
      return undefined
    }

    current = current[segment]
  }

  return current
}

export type EnhancedContractRouter<T extends AnyContractRouter, TErrorMap extends ErrorMap>
  = T extends ContractProcedure<infer UInputSchema, infer UOutputSchema, infer UErrors, infer UMeta>
    ? ContractProcedure<UInputSchema, UOutputSchema, MergedErrorMap<TErrorMap, UErrors>, UMeta>
    : {
        [K in keyof T]: T[K] extends AnyContractRouter ? EnhancedContractRouter<T[K], TErrorMap> : never
      }

export interface EnhanceContractRouterOptions<TErrorMap extends ErrorMap> extends EnhanceRouteOptions {
  errorMap: TErrorMap
}

export function enhanceContractRouter<T extends AnyContractRouter, TErrorMap extends ErrorMap>(
  router: T,
  options: EnhanceContractRouterOptions<TErrorMap>,
): EnhancedContractRouter<T, TErrorMap> {
  if (isContractProcedure(router)) {
    const enhanced = new ContractProcedure({
      ...router['~orpc'],
      errorMap: mergeErrorMap(options.errorMap, router['~orpc'].errorMap),
      route: enhanceRoute(router['~orpc'].route, options),
    })

    return enhanced as any
  }

  const enhanced: Record<string, any> = {}

  for (const key in router) {
    enhanced[key] = enhanceContractRouter(router[key]!, options)
  }

  return enhanced as any
}

/**
 * Minify a contract router into a smaller object.
 *
 * You should export the result to a JSON file. On the client side, you can import this JSON file and use it as a contract router.
 * This reduces the size of the contract and helps prevent leaking internal details of the router to the client.
 *
 * @see {@link https://orpc.dev/docs/contract-first/router-to-contract#minify-export-the-contract-router-for-the-client Router to Contract Docs}
 */
export function minifyContractRouter(router: AnyContractRouter): AnyContractRouter {
  if (isContractProcedure(router)) {
    const procedure: AnyContractProcedure = {
      '~orpc': {
        errorMap: {},
        meta: router['~orpc'].meta,
        route: router['~orpc'].route,
      },
    }

    return procedure
  }

  const json: Record<string, AnyContractRouter> = {}

  for (const key in router) {
    json[key] = minifyContractRouter(router[key]!)
  }

  return json
}

export type PopulatedContractRouterPaths<T extends AnyContractRouter>
  = T extends ContractProcedure<infer UInputSchema, infer UOutputSchema, infer UErrors, infer UMeta>
    ? ContractProcedure<UInputSchema, UOutputSchema, UErrors, UMeta>
    : {
        [K in keyof T]: T[K] extends AnyContractRouter ? PopulatedContractRouterPaths<T[K]> : never
      }

export interface PopulateContractRouterPathsOptions {
  path?: readonly string[]
}

/**
 * Automatically populates missing route paths using the router's nested keys.
 *
 * Constructs paths by joining router keys with `/`.
 * Useful for NestJS integration that require explicit route paths.
 *
 * @see {@link https://orpc.dev/docs/openapi/integrations/implement-contract-in-nest#define-your-contract NestJS Implement Contract Docs}
 */
export function populateContractRouterPaths<T extends AnyContractRouter>(router: T, options: PopulateContractRouterPathsOptions = {}): PopulatedContractRouterPaths<T> {
  const path = toArray(options.path)

  if (isContractProcedure(router)) {
    if (router['~orpc'].route.path === undefined) {
      return new ContractProcedure({
        ...router['~orpc'],
        route: {
          ...router['~orpc'].route,
          path: toHttpPath(path),
        },
      }) as any
    }

    return router as any
  }

  const populated: Record<string, any> = {}

  for (const key in router) {
    populated[key] = populateContractRouterPaths(router[key]!, { ...options, path: [...path, key] })
  }

  return populated as any
}
