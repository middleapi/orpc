import type { AnyProcedureContract, AugmentContractRouterOptions, ErrorMap, MergedErrorMap, RouterContract } from '@orpc/contract'
import type { Promisable } from '@orpc/shared'
import type { Context, MergedInitialContext } from './context'
import type { Lazyable } from './lazy'
import type { AnyMiddleware } from './middleware'
import type { AnyProcedure, ProcedureConfig } from './procedure'
import type { AnyRouter } from './router'
import { mergeErrorMap, ProcedureContract, resolveMetaPlugins } from '@orpc/contract'
import { getOwn, isTypescriptObject, omit } from '@orpc/shared'
import { Lazy, unlazy } from './lazy'
import { Procedure } from './procedure'
import { createContractProcedure } from './procedure-utils'
import { getHiddenRouterContract, withHiddenRouterContract } from './router-hidden'

export type AugmentedRouter<
  T extends AnyRouter,
  TErrorMap extends ErrorMap,
> = T extends Procedure<
  infer $InitialContext,
  infer $CurrentContext,
  infer $InputSchema,
  infer $OutputSchema,
  infer $ErrorMap
>
  ? Procedure<
    $InitialContext,
    $CurrentContext,
    $InputSchema,
    $OutputSchema,
    MergedErrorMap<TErrorMap, $ErrorMap>
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
    infer $ErrorMap
  >
    ? Procedure<
      MergedInitialContext<TInitialContext, TInjectedContext, $InitialContext>,
      $CurrentContext,
      $InputSchema,
      $OutputSchema,
      MergedErrorMap<TErrorMap, $ErrorMap>
    >
    : {
        [K in keyof T]: T[K] extends Lazy<infer $ extends AnyRouter>
          ? Lazy<AugmentedRouterWithMiddlewares<$, TInitialContext, TInjectedContext, TErrorMap>>
          : T[K] extends AnyRouter
            ? AugmentedRouterWithMiddlewares<T[K], TInitialContext, TInjectedContext, TErrorMap>
            : never
      }

interface AugmentRouterOptions<TErrorMap extends ErrorMap> extends AugmentContractRouterOptions<TErrorMap>, ProcedureConfig {
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
      ...omit(options, ['middlewares', 'errorMap', 'meta', 'metaPlugins']),
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

  for (const [key, child] of Object.entries(router as Record<string, AnyRouter>)) {
    enhanced[key] = augmentRouter(child, options)
  }

  return enhanced as any
}

interface AugmentImplementedRouterOptions extends ProcedureConfig {
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
      ...omit(options, ['middlewares']),
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

  for (const [key, child] of Object.entries(router as Record<string, AnyRouter>)) {
    enhanced[key] = augmentImplementedRouter(child, options)
  }

  return enhanced as any
}

/**
 * Resolves the procedure of a contract walked from a router: the procedure itself,
 * or the implementation of a contract-first procedure, looked up by its path.
 *
 * @throws {TypeError} If a contract-first procedure has no valid implementation.
 */
export async function resolveContractProcedure(router: AnyRouter, contract: AnyProcedureContract, path: readonly string[]): Promise<AnyProcedure> {
  if (contract instanceof Procedure) {
    return contract
  }

  const { default: maybeProcedure } = await unlazy(getRouter(router, path))

  if (!(maybeProcedure instanceof Procedure)) {
    throw new TypeError(
      `[Contract-First] Missing or invalid implementation for procedure at path: "${path.join('.')}". `
      + `Ensure the procedure is correctly implemented and matches its contract.`,
    )
  }

  return createContractProcedure(maybeProcedure, contract)
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
      current = getOwn(current, segment)

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

/**
 * Converts a procedure found inside a hidden contract into a plain {@link ProcedureContract}.
 *
 * A normal router can be passed to `implement()` as a contract, so a hidden contract
 * may contain procedures. Those are contracts only: their handlers and middlewares must never
 * be served in place of the implementation, which is resolved by path instead.
 */
function toPlainProcedureContract(contract: AnyProcedureContract): AnyProcedureContract {
  if (!(contract instanceof Procedure)) {
    return contract
  }

  const { inputSchemas, outputSchemas, metaPlugins, errorMap, meta } = contract['~orpc']

  return new ProcedureContract({ inputSchemas, outputSchemas, metaPlugins, errorMap, meta })
}

/**
 * Wraps a lazy router found inside a hidden contract, so walking it later still treats it as a contract.
 */
function toLazyHiddenContract(lazy: Lazy<AnyRouter>): Lazy<AnyRouter> {
  return new Lazy({
    ...lazy['~orpc'],
    async loader() {
      const { default: contract } = await unlazy(lazy)

      return {
        default: isTypescriptObject(contract)
          ? withHiddenRouterContract(contract, contract as RouterContract)
          : contract,
      }
    },
  })
}

/**
 * Walks the procedure contracts of a router, preferring its hidden contract when present.
 *
 * Procedures are passed to the callback as is only when they come from the router itself, so
 * `instanceof Procedure` means the callback received the implementation. Procedures inside a hidden
 * contract are passed as plain {@link ProcedureContract}s, use {@link resolveContractProcedure}
 * to resolve their implementation.
 */
export function walkProcedureContractsSync(
  router: RouterContract | AnyRouter,
  callback: (contract: AnyProcedureContract | AnyProcedure, path: string[]) => void,
  path: string[] = [],
): WalkProcedureContractsLazyResult[] {
  const lazyResults: WalkProcedureContractsLazyResult[] = []

  walkProcedureContractsSyncInternal(router, callback, path.slice(), lazyResults, false)

  return lazyResults
}

function walkProcedureContractsSyncInternal(
  router: RouterContract | AnyRouter,
  callback: (contract: AnyProcedureContract | AnyProcedure, path: string[]) => void,
  path: string[],
  lazyResults: WalkProcedureContractsLazyResult[],
  isContract: boolean,
): void {
  const hiddenContract = getHiddenRouterContract(router)
  if (hiddenContract !== undefined) {
    router = hiddenContract
    isContract = true
  }

  if (router instanceof ProcedureContract) {
    callback(isContract ? toPlainProcedureContract(router) : router, path.slice())
    return
  }

  if (!isTypescriptObject(router)) {
    return
  }

  for (const [key, value] of Object.entries(router)) {
    path.push(key)

    if (value instanceof Lazy) {
      lazyResults.push({ router: isContract ? toLazyHiddenContract(value) : value, path: path.slice() })
    }
    else {
      walkProcedureContractsSyncInternal(value, callback, path, lazyResults, isContract)
    }

    path.pop()
  }
}

/**
 * Asynchronously walks the procedure contracts of a router, including lazy ones,
 * preferring its hidden contract when present.
 *
 * Procedures are passed to the callback as is only when they come from the router itself, so
 * `instanceof Procedure` means the callback received the implementation. Procedures inside a hidden
 * contract are passed as plain {@link ProcedureContract}s, use {@link resolveContractProcedure}
 * to resolve their implementation.
 */
export async function walkProcedureContractsAsync(
  router: RouterContract | AnyRouter,
  callback: (contract: AnyProcedureContract | AnyProcedure, path: string[]) => Promisable<void>,
  path: string[] = [],
): Promise<void> {
  await walkProcedureContractsAsyncInternal(router, callback, path, false)
}

async function walkProcedureContractsAsyncInternal(
  router: RouterContract | AnyRouter,
  callback: (contract: AnyProcedureContract | AnyProcedure, path: string[]) => Promisable<void>,
  path: string[],
  isContract: boolean,
): Promise<void> {
  const hiddenContract = getHiddenRouterContract(router)
  if (hiddenContract !== undefined) {
    router = hiddenContract
    isContract = true
  }

  if (router instanceof ProcedureContract) {
    await callback(isContract ? toPlainProcedureContract(router) : router, path)
    return
  }

  if (!isTypescriptObject(router)) {
    return
  }

  for (const [key, value] of Object.entries(router)) {
    if (value instanceof Lazy) {
      const { default: router } = await unlazy(value)
      await walkProcedureContractsAsyncInternal(router, callback, [...path, key], isContract)
    }
    else {
      await walkProcedureContractsAsyncInternal(value, callback, [...path, key], isContract)
    }
  }
}

export type UnlaziedRouter<T extends AnyRouter>
  = T extends AnyProcedure
    ? T
    : {
        [K in keyof T]: T[K] extends Lazyable<infer U extends AnyRouter> ? UnlaziedRouter<U> : never
      }

/**
 * Fully resolves all lazy routers inside a router, returning a plain router.
 * Useful for making a router with lazy parts contract-compatible.
 *
 * @see {@link https://orpc.dev/docs/contract/router#router-to-contract | Router Contract - Router to Contract}
 */
export async function unlazyRouter<T extends AnyRouter>(router: T): Promise<UnlaziedRouter<T>> {
  if (router instanceof Procedure) {
    return router as any
  }

  if (!isTypescriptObject(router)) {
    return router as any
  }

  const unlazied = {} as Record<string, any>

  for (const key of Object.keys(router)) {
    const item: Lazyable<AnyRouter> = router[key]!

    const { default: unlaziedRouter } = await unlazy(item)

    unlazied[key] = await unlazyRouter(unlaziedRouter)
  }

  return unlazied as any
}
