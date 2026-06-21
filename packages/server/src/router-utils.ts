import type { AnyProcedureContract, AugmentContractRouterOptions, ErrorMap, MergedErrorMap, RouterContract } from '@orpc/contract'
import type { Promisable } from '@orpc/shared'
import type { Context, MergedInitialContext } from './context'
import type { Lazyable } from './lazy'
import type { AnyMiddleware } from './middleware'
import type { AnyProcedure } from './procedure'
import type { AnyRouter } from './router'
import { mergeErrorMap, ProcedureContract, resolveMetaPlugins } from '@orpc/contract'
import { isTypescriptObject } from '@orpc/shared'
import { Lazy, unlazy } from './lazy'
import { Procedure } from './procedure'
import { getHiddenRouterContract } from './router-hidden'

export type AugmentedRouter<
  T extends AnyRouter,
  TErrorMap extends ErrorMap,
> = T extends Procedure<
  infer $InitialContext,
  infer $CurrentContext,
  infer $InputSchema,
  infer $OutputSchema,
  infer $ErrorMap,
  infer $ReturnedORPCError
>
  ? Procedure<
    $InitialContext,
    $CurrentContext,
    $InputSchema,
    $OutputSchema,
    MergedErrorMap<TErrorMap, $ErrorMap>,
    $ReturnedORPCError
  >
  : {
      [K in keyof T]: T[K] extends Lazy<infer $ extends AnyRouter>
        ? Lazy<AugmentedRouter<$, TErrorMap>>
        : T[K] extends AnyRouter
          ? AugmentedRouter<T[K], TErrorMap>
          : never
    }

export type AugmentedRouterWithMiddlewares<
  T extends AnyRouter,
  TInitialContext extends Context,
  TInjectedContext extends Context,
  TErrorMap extends ErrorMap,
>
  = T extends Procedure<
    infer $InitialContext,
    infer $CurrentContext,
    infer $InputSchema,
    infer $OutputSchema,
    infer $ErrorMap,
    infer $ReturnedORPCError
  >
    ? Procedure<
      MergedInitialContext<TInitialContext, TInjectedContext, $InitialContext>,
      $CurrentContext,
      $InputSchema,
      $OutputSchema,
      MergedErrorMap<TErrorMap, $ErrorMap>,
      $ReturnedORPCError
    >
    : {
        [K in keyof T]: T[K] extends Lazy<infer $ extends AnyRouter>
          ? Lazy<AugmentedRouterWithMiddlewares<$, TInitialContext, TInjectedContext, TErrorMap>>
          : T[K] extends AnyRouter
            ? AugmentedRouterWithMiddlewares<T[K], TInitialContext, TInjectedContext, TErrorMap>
            : never
      }

export interface AugmentRouterOptions<TErrorMap extends ErrorMap> extends AugmentContractRouterOptions<TErrorMap> {
  middlewares: AnyMiddleware[]
}

export function augmentRouter<
  T extends AnyRouter,
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TErrorMap extends ErrorMap,
>(
  router: T,
  options: AugmentRouterOptions<TErrorMap>,
): AugmentedRouter<T, TErrorMap> | AugmentedRouterWithMiddlewares<T, TInitialContext, TCurrentContext, TErrorMap> {
  if (router instanceof Lazy) {
    const [meta, metaPlugins] = resolveMetaPlugins(
      options.meta,
      options.metaPlugins,
      router['~orpc'].metaPlugins,
    )

    const enhanced = new Lazy({
      meta,
      metaPlugins,
      async loader() {
        const { default: unlaziedRouter } = await unlazy(router)
        const enhanced = augmentRouter(unlaziedRouter, options)
        return unlazy(enhanced)
      },
    })

    return enhanced as any
  }

  if (router instanceof Procedure) {
    const [meta, metaPlugins] = resolveMetaPlugins(
      options.meta,
      options.metaPlugins,
      router['~orpc'].metaPlugins,
    )

    const enhanced = new Procedure({
      ...router['~orpc'],
      meta,
      metaPlugins,
      errorMap: mergeErrorMap(options.errorMap, router['~orpc'].errorMap),
      orderedMiddlewares: [
        ...options.middlewares.map(middleware => ({ middleware, inputSchemasLengthAtUse: 0, outputSchemasLengthAtUse: 0 })),
        ...router['~orpc'].orderedMiddlewares,
      ],
    })

    return enhanced as any
  }

  if (!isTypescriptObject(router)) {
    return router as any
  }

  const enhanced = {} as Record<string, any>

  for (const key in router) {
    enhanced[key] = augmentRouter((router as Record<string, AnyRouter>)[key]!, options)
  }

  return enhanced as any
}

export interface AugmentImplementedRouterOptions {
  middlewares: AnyMiddleware[]
}

export function augmentImplementedRouter<
  T extends AnyRouter,
  TInitialContext extends Context,
  TCurrentContext extends Context,
>(
  router: T,
  options: AugmentImplementedRouterOptions,
): AugmentedRouter<T, object> | AugmentedRouterWithMiddlewares<T, TInitialContext, TCurrentContext, object> {
  if (router instanceof Lazy) {
    const enhanced = new Lazy({
      ...router['~orpc'],
      async loader() {
        const { default: unlaziedRouter } = await unlazy(router)
        const enhanced = augmentImplementedRouter(unlaziedRouter, options)
        return unlazy(enhanced)
      },
    })

    return enhanced as any
  }

  if (router instanceof Procedure) {
    const enhanced = new Procedure({
      ...router['~orpc'],
      orderedMiddlewares: [
        ...options.middlewares.map(middleware => ({ middleware, inputSchemasLengthAtUse: 0, outputSchemasLengthAtUse: 0 })),
        ...router['~orpc'].orderedMiddlewares,
      ],
    })

    return enhanced as any
  }

  if (!isTypescriptObject(router)) {
    return router as any
  }

  const enhanced = {} as Record<string, any>

  for (const key in router) {
    enhanced[key] = augmentImplementedRouter((router as Record<string, AnyRouter>)[key]!, options)
  }

  return enhanced as any
}

export function getRouter<T extends Lazyable<AnyRouter | undefined>>(
  router: T,
  path: readonly string[],
): T extends Lazy<any> ? Lazy<AnyRouter | undefined> : Lazyable<AnyRouter | undefined> {
  let current: Lazyable<AnyRouter | undefined> = router

  for (let i = 0; i < path.length; i++) {
    const segment = path[i]!

    if (!isTypescriptObject(current)) {
      return undefined as any
    }

    if (current instanceof Procedure) {
      return undefined as any
    }

    if (!(current instanceof Lazy)) {
      current = current[segment]

      continue
    }

    const lazied = current
    const rest = path.slice(i)

    return new Lazy({
      ...lazied['~orpc'],
      async loader() {
        const unwrapped = await unlazy(lazied)

        const next = getRouter(unwrapped.default, rest)

        return await unlazy(next)
      },
    })
  }

  if (!isTypescriptObject(current)) {
    return undefined as any
  }

  return current as any
}

export interface WalkProcedureContractsLazyResult {
  router: Lazy<AnyRouter>
  path: string[]
}

export function walkProcedureContractsSync(
  router: RouterContract | AnyRouter,
  callback: (contract: AnyProcedureContract | AnyProcedure, path: string[]) => void,
  path: string[] = [],
): WalkProcedureContractsLazyResult[] {
  const hiddenContract = getHiddenRouterContract(router)
  if (hiddenContract !== undefined) {
    router = hiddenContract
  }

  if (router instanceof ProcedureContract) {
    callback(router, path)
    return []
  }

  if (!isTypescriptObject(router)) {
    return []
  }

  const lazyResults: WalkProcedureContractsLazyResult[] = []

  for (const key in router) {
    const value = (router as any)[key]

    if (value instanceof Lazy) {
      lazyResults.push({ router: value, path: [...path, key] })
    }
    else {
      lazyResults.push(...walkProcedureContractsSync(value, callback, [...path, key]))
    }
  }

  return lazyResults
}

export async function walkProcedureContractsAsync(
  router: RouterContract | AnyRouter,
  callback: (contract: AnyProcedureContract | AnyProcedure, path: string[]) => Promisable<void>,
  path: string[] = [],
): Promise<void> {
  const hiddenContract = getHiddenRouterContract(router)
  if (hiddenContract !== undefined) {
    router = hiddenContract
  }

  if (router instanceof ProcedureContract) {
    await callback(router, path)
    return
  }

  if (!isTypescriptObject(router)) {
    return
  }

  for (const key in router) {
    const value = (router as any)[key]

    if (value instanceof Lazy) {
      const { default: router } = await unlazy(value)
      await walkProcedureContractsAsync(router, callback, [...path, key])
    }
    else {
      await walkProcedureContractsAsync(value, callback, [...path, key])
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
  if (router instanceof Procedure) {
    return router as any
  }

  if (!isTypescriptObject(router)) {
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
