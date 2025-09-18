import type { AnyContractProcedure, AnyContractRouter, EnhanceRouteOptions, ErrorMap, MergedErrorMap } from '@orpc/contract'
import type { Context, MergedInitialContext } from './context'
import type { Lazy, Lazyable } from './lazy'
import type { AnyMiddleware } from './middleware'
import type { AnyProcedure } from './procedure'
import type { AnyRouter } from './router'
import { enhanceRoute, isContractProcedure, mergeErrorMap, mergePrefix } from '@orpc/contract'
import { getLazyMeta, isLazy, lazy, unlazy } from './lazy'
import { mergeMiddlewares } from './middleware-utils'
import { isProcedure, Procedure } from './procedure'
import { getHiddenRouterContract } from './router-hidden'

export function getRouter<T extends Lazyable<AnyRouter | undefined>>(
  router: T,
  path: readonly string[],
): T extends Lazy<any> ? Lazy<AnyRouter | undefined> : Lazyable<AnyRouter | undefined> {
  let current: Lazyable<AnyRouter | undefined> = router

  for (let i = 0; i < path.length; i++) {
    const segment = path[i]!

    if (!current) {
      return undefined as any
    }

    if (isProcedure(current)) {
      return undefined as any
    }

    if (!isLazy(current)) {
      current = current[segment]

      continue
    }

    const lazied = current
    const rest = path.slice(i)

    return lazy(async () => {
      const unwrapped = await unlazy(lazied)

      const next = getRouter(unwrapped.default, rest)

      return unlazy(next)
    }, getLazyMeta(lazied))
  }

  return current as any
}

export type AccessibleLazyRouter<T extends Lazyable<AnyRouter | undefined>>
  = T extends Lazy<infer U extends AnyRouter | undefined | Lazy<AnyRouter | undefined>>
    ? AccessibleLazyRouter<U>
    : T extends AnyProcedure | undefined
      ? Lazy<T>
      : Lazy<T> & {
        [K in keyof T]: T[K] extends Lazyable<AnyRouter> ? AccessibleLazyRouter<T[K]> : never
      }

export function createAccessibleLazyRouter<T extends Lazy<AnyRouter | undefined>>(lazied: T): AccessibleLazyRouter<T> {
  const recursive = new Proxy(lazied, {
    get(target, key) {
      if (typeof key !== 'string') {
        return Reflect.get(target, key)
      }

      const next = getRouter(lazied, [key])

      return createAccessibleLazyRouter(next)
    },
  })

  return recursive as any
}

export type EnhancedRouter<
  T extends Lazyable<AnyRouter>,
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TErrorMap extends ErrorMap,
>
  = T extends Lazy<infer U extends AnyRouter>
    ? AccessibleLazyRouter<EnhancedRouter<U, TInitialContext, TCurrentContext, TErrorMap>>
    : T extends Procedure<
      infer UInitialContext,
      infer UCurrentContext,
      infer UInputSchema,
      infer UOutputSchema,
      infer UErrorMap,
      infer UMeta
    >
      ? Procedure<
        MergedInitialContext<TInitialContext, UInitialContext, TCurrentContext>,
        UCurrentContext,
        UInputSchema,
        UOutputSchema,
        MergedErrorMap<TErrorMap, UErrorMap>,
        UMeta
      >
      : {
          [K in keyof T]: T[K] extends Lazyable<AnyRouter> ? EnhancedRouter<T[K], TInitialContext, TCurrentContext, TErrorMap> : never
        }

export interface EnhanceRouterOptions<TErrorMap extends ErrorMap> extends EnhanceRouteOptions {
  middlewares: readonly AnyMiddleware[]
  errorMap: TErrorMap
  dedupeLeadingMiddlewares: boolean
}

export function enhanceRouter<
  T extends Lazyable<AnyRouter>,
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TErrorMap extends ErrorMap,
>(
  router: T,
  options: EnhanceRouterOptions<TErrorMap>,
): EnhancedRouter<T, TInitialContext, TCurrentContext, TErrorMap> {
  if (isLazy(router)) {
    const laziedMeta = getLazyMeta(router)
    const enhancedPrefix = laziedMeta?.prefix ? mergePrefix(options.prefix, laziedMeta?.prefix) : options.prefix

    const enhanced = lazy(async () => {
      const { default: unlaziedRouter } = await unlazy(router)
      const enhanced = enhanceRouter(unlaziedRouter, options)
      return unlazy(enhanced)
    }, {
      ...laziedMeta,
      prefix: enhancedPrefix,
    })

    const accessible = createAccessibleLazyRouter(enhanced)

    return accessible as any
  }

  if (isProcedure(router)) {
    const newMiddlewares = mergeMiddlewares(options.middlewares, router['~orpc'].middlewares, { dedupeLeading: options.dedupeLeadingMiddlewares })
    const newMiddlewareAdded = newMiddlewares.length - router['~orpc'].middlewares.length

    const enhanced = new Procedure({
      ...router['~orpc'],
      route: enhanceRoute(router['~orpc'].route, options),
      errorMap: mergeErrorMap(options.errorMap, router['~orpc'].errorMap),
      middlewares: newMiddlewares,
      inputValidationIndex: router['~orpc'].inputValidationIndex + newMiddlewareAdded,
      outputValidationIndex: router['~orpc'].outputValidationIndex + newMiddlewareAdded,
    })

    return enhanced as any
  }

  const enhanced = {} as Record<string, any>

  for (const key in router) {
    enhanced[key] = enhanceRouter(router[key]!, options)
  }

  return enhanced as any
}

export interface TraverseContractProceduresOptions {
  router: AnyContractRouter | AnyRouter
  path: readonly string[]
}

export interface TraverseContractProcedureCallbackOptions {
  contract: AnyContractProcedure | AnyProcedure
  path: readonly string[]
}

/**
 * @deprecated Use `TraverseContractProcedureCallbackOptions` instead.
 */
export type ContractProcedureCallbackOptions = TraverseContractProcedureCallbackOptions

export interface LazyTraverseContractProceduresOptions {
  router: Lazy<AnyRouter>
  path: readonly string[]
}

export function traverseContractProcedures(
  options: TraverseContractProceduresOptions,
  callback: (options: TraverseContractProcedureCallbackOptions) => void,
  lazyOptions: LazyTraverseContractProceduresOptions[] = [],
): LazyTraverseContractProceduresOptions[] {
  let currentRouter: AnyContractRouter | Lazyable<AnyRouter> = options.router

  const hiddenContract = getHiddenRouterContract(options.router)

  if (hiddenContract !== undefined) {
    currentRouter = hiddenContract
  }

  if (isLazy(currentRouter)) {
    lazyOptions.push({
      router: currentRouter,
      path: options.path,
    })
  }

  else if (isContractProcedure(currentRouter)) {
    callback({
      contract: currentRouter,
      path: options.path,
    })
  }

  else {
    for (const key in currentRouter) {
      traverseContractProcedures(
        {
          router: (currentRouter as any)[key],
          path: [...options.path, key],
        },
        callback,
        lazyOptions,
      )
    }
  }

  return lazyOptions
}

export async function resolveContractProcedures(
  options: TraverseContractProceduresOptions,
  callback: (options: TraverseContractProcedureCallbackOptions) => void,
) {
  const pending: TraverseContractProceduresOptions[] = [options]

  for (const options of pending) {
    const lazyOptions = traverseContractProcedures(options, callback)

    for (const options of lazyOptions) {
      const { default: router } = await unlazy(options.router)

      pending.push({
        router,
        path: options.path,
      })
    }
  }
}

export type UnlaziedRouter<T extends AnyRouter>
  = T extends AnyProcedure
    ? T
    : {
        [K in keyof T]: T[K] extends Lazyable<infer U extends AnyRouter> ? UnlaziedRouter<U> : never
      }

export async function unlazyRouter<T extends AnyRouter>(router: T): Promise<UnlaziedRouter<T>> {
  if (isProcedure(router)) {
    return router as any
  }

  const unlazied = {} as Record<string, any>

  for (const key in router) {
    const item: Lazyable<AnyRouter> = router[key]!

    const { default: unlaziedRouter } = await unlazy(item)

    unlazied[key] = await unlazyRouter(unlaziedRouter)
  }

  return unlazied as any
}
