import type { ErrorMap, InferRouterContractErrorMap, RouterContract } from '@orpc/contract'
import type { AnyFunction, IntersectPick, Public } from '@orpc/shared'
import type { Context, MergedContext, MergedInitialContext } from './context'
import type { AnyMiddleware, Middleware } from './middleware'
import type { DecoratedMiddleware } from './middleware-decorated'
import type { ContractedRouter } from './router'
import type { AugmentedRouterWithMiddlewares } from './router-utils'
import { ProcedureContract } from '@orpc/contract'
import { bindMethods, getOrBind } from '@orpc/shared'
import { ProcedureImplementer } from './implementer-procedure'
import { Lazy } from './lazy'
import { decorateMiddleware } from './middleware-decorated'
import { withHiddenRouterContract } from './router-hidden'
import { augmentImplementedRouter } from './router-utils'

export class SharedRouterImplementer<
  TContract extends RouterContract,
  TInitialContext extends Context,
> {
  private constructor(
    private readonly contract: TContract,
    private readonly middlewares: AnyMiddleware[],
  ) {}

  static create<TContract extends RouterContract, TInitialContext extends Context>(
    contract: TContract,
  ): SharedRouterImplementer<TContract, TInitialContext>

  static create<TContract extends RouterContract, TInitialContext extends Context, TInjectedContext extends Context>(
    contract: TContract,
    middlewares: AnyMiddleware[],
  ): SharedRouterImplementerWithMiddlewares<TContract, TInitialContext, TInjectedContext>

  static create<TContract extends RouterContract, TInitialContext extends Context, TInjectedContext extends Context>(
    contract: TContract,
    middlewares: AnyMiddleware[] = [],
  ): SharedRouterImplementer<TContract, TInitialContext> | SharedRouterImplementerWithMiddlewares<TContract, TInitialContext, TInjectedContext> {
    return new SharedRouterImplementer(contract, middlewares)
  }

  use<
    $OutContext extends IntersectPick<TInitialContext, $OutContext>,
    $InContext extends Context = TInitialContext,
    $ErrorMap extends ErrorMap = InferRouterContractErrorMap<TContract>,
  >(
    middleware: Middleware<
      $InContext | TInitialContext,
      $OutContext,
      unknown,
      unknown,
      $ErrorMap
    >,
  ): RouterImplementerWithMiddlewares<
    TContract,
    MergedInitialContext<TInitialContext, object, $InContext>,
    $OutContext
  > {
    return createRouterImplementerInternal(this.contract, [...this.middlewares, middleware]) as any
  }

  middleware<
    $OutContext extends IntersectPick<TInitialContext, $OutContext>,
    $Input,
    $InContext extends Context = TInitialContext,
    $Output = any, // $Output = any by default is important to make middleware can be used in any output by default
  >(
    middleware: Middleware<
      $InContext | TInitialContext,
      $OutContext,
      $Input,
      $Output,
      InferRouterContractErrorMap<TContract>
    >,
  ): DecoratedMiddleware<
    MergedInitialContext<TInitialContext, object, $InContext>,
    $OutContext,
    $Input,
    $Output,
    object
  > {
    const allMiddlewares = [
      ...this.middlewares,
      middleware,
    ]

    let current = decorateMiddleware(allMiddlewares.shift()!)

    for (const mid of allMiddlewares) {
      current = current.use(mid) as any
    }

    return current
  }

  router<T extends ContractedRouter<TContract, any>>(
    router: T,
  ): T {
    if (this.middlewares.length) {
      router = augmentImplementedRouter(router, {
        middlewares: this.middlewares,
      }) as any
    }

    return withHiddenRouterContract(router, this.contract)
  }

  lazy<T extends ContractedRouter<TContract, any>>(
    loader: () => Promise<{ default: T }>,
  ): Lazy<T> {
    if (this.middlewares.length) {
      const originalLoader = loader
      loader = async () => {
        const { default: router } = await originalLoader()
        return {
          default: augmentImplementedRouter(router, {
            middlewares: this.middlewares,
          }) as any,
        }
      }
    }

    return new Lazy({ loader, meta: {} })
  }
}

export interface SharedRouterImplementerWithMiddlewares<
  TContract extends RouterContract,
  TInitialContext extends Context,
  TInjectedContext extends Context,
> {
  use<
    $OutContext extends IntersectPick<MergedContext<TInitialContext, TInjectedContext>, $OutContext>,
    $InContext extends Context = MergedContext<TInitialContext, TInjectedContext>,
    $ErrorMap extends ErrorMap = InferRouterContractErrorMap<TContract>,
  >(
    middleware: Middleware<
      $InContext | MergedContext<TInitialContext, TInjectedContext>,
      $OutContext,
      unknown,
      unknown,
      $ErrorMap
    >,
  ): RouterImplementerWithMiddlewares<
    TContract,
    MergedInitialContext<TInitialContext, TInjectedContext, $InContext>,
    MergedContext<TInjectedContext, $OutContext>
  >

  middleware<
    $OutContext extends IntersectPick<MergedContext<TInitialContext, TInjectedContext>, $OutContext>,
    $Input,
    $InContext extends Context = MergedContext<TInitialContext, TInjectedContext>,
    $Output = any, // $Output = any by default is important to make middleware can be used in any output by default
  >(
    middleware: Middleware<
      $InContext | MergedContext<TInitialContext, TInjectedContext>,
      $OutContext,
      $Input,
      $Output,
      InferRouterContractErrorMap<TContract>
    >,
  ): DecoratedMiddleware<
    MergedInitialContext<TInitialContext, TInjectedContext, $InContext>,
    MergedContext<TInjectedContext, $OutContext>,
    $Input,
    $Output,
    object
  >

  router<T extends ContractedRouter<TContract, MergedContext<TInitialContext, TInjectedContext>>>(
    router: T,
  ): AugmentedRouterWithMiddlewares<T, TInitialContext, TInjectedContext, object>

  lazy<T extends ContractedRouter<TContract, any>>(
    loader: () => Promise<{ default: T }>,
  ): Lazy<AugmentedRouterWithMiddlewares<T, TInitialContext, TInjectedContext, object>>
}

export type RouterImplementer<
  TContract extends RouterContract,
  TInitialContext extends Context,
> = TContract extends ProcedureContract<infer $InputSchema, infer $OutputSchema, infer $ErrorMap>
  ? ProcedureImplementer<TInitialContext, object, $InputSchema, $OutputSchema, $ErrorMap>
  : Public<SharedRouterImplementer<TContract, TInitialContext>> & {
    [K in keyof TContract]: TContract[K] extends RouterContract
      ? RouterImplementer<TContract[K], TInitialContext>
      : never
  }

export type RouterImplementerWithMiddlewares<
  TContract extends RouterContract,
  TInitialContext extends Context,
  TInjectedContext extends Context,
> = TContract extends ProcedureContract<infer $InputSchema, infer $OutputSchema, infer $ErrorMap>
  ? ProcedureImplementer<TInitialContext, TInjectedContext, $InputSchema, $OutputSchema, $ErrorMap>
  : SharedRouterImplementerWithMiddlewares<TContract, TInitialContext, TInjectedContext> & {
    [K in keyof TContract]: TContract[K] extends RouterContract
      ? RouterImplementerWithMiddlewares<TContract[K], TInitialContext, TInjectedContext>
      : never
  }

export function createRouterImplementer<
  TContract extends RouterContract,
  TInitialContext extends Context,
>(
  contract: TContract,
): RouterImplementer<TContract, TInitialContext> {
  return createRouterImplementerInternal(contract, []) as any
}

function createRouterImplementerInternal<
  TContract extends RouterContract,
  TInitialContext extends Context,
  TInjectedContext extends Context,
>(
  contract: TContract,
  middlewares: AnyMiddleware[],
): RouterImplementer<TContract, TInitialContext> | RouterImplementerWithMiddlewares<TContract, TInitialContext, TInjectedContext> {
  if (contract instanceof ProcedureContract) {
    return new ProcedureImplementer({
      ...contract['~orpc'],
      orderedMiddlewares: middlewares.map(middleware => ({ middleware })),
    }) as any
  }

  const implementer: Record<string, any> = {}

  for (const key in contract) {
    const child = contract[key] as RouterContract
    implementer[key] = createRouterImplementerInternal(child, middlewares)
  }

  const shared = bindMethods(SharedRouterImplementer.create(contract, middlewares))

  for (const key in shared) {
    const method = (shared as any)[key] as AnyFunction

    if (key in implementer) {
      const child = implementer[key]

      implementer[key] = new Proxy(method, {
        get(_, p) {
          return getOrBind(child, p)
        },
      })
    }
    else {
      implementer[key] = method
    }
  }

  return implementer as any
}
