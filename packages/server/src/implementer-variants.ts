import type { AnyContractRouter, ContractProcedure, InferContractRouterErrorMap, InferContractRouterMeta } from '@orpc/contract'
import type { IntersectPick } from '@orpc/shared'
import type { Context, MergedCurrentContext, MergedInitialContext } from './context'
import type { ORPCErrorConstructorMap } from './error'
import type { ProcedureImplementer } from './implementer-procedure'
import type { Lazy } from './lazy'
import type { Middleware } from './middleware'
import type { Router } from './router'
import type { EnhancedRouter } from './router-utils'

export interface RouterImplementerWithMiddlewares<
  T extends AnyContractRouter,
  TInitialContext extends Context,
  TCurrentContext extends Context,
> {
  /**
   * Uses a middleware to modify the context or improve the pipeline.
   *
   * @info Supports both normal middleware and inline middleware implementations.
   * @note The current context must be satisfy middleware dependent-context
   * @see {@link https://orpc.unnoq.com/docs/middleware Middleware Docs}
   */
  use<UOutContext extends IntersectPick<TCurrentContext, UOutContext>, UInContext extends Context = TCurrentContext>(
    middleware: Middleware<
      UInContext | TCurrentContext,
      UOutContext,
      unknown,
      unknown,
      ORPCErrorConstructorMap<InferContractRouterErrorMap<T>>,
      InferContractRouterMeta<T>
    >,
  ): ImplementerInternalWithMiddlewares<
    T,
    MergedInitialContext<TInitialContext, UInContext, TCurrentContext>,
    MergedCurrentContext<TCurrentContext, UOutContext>
  >

  /**
   * Applies all of the previously defined options to the specified router.
   * And enforces the router match the contract.
   *
   * @see {@link https://orpc.unnoq.com/docs/router#extending-router Extending Router Docs}
   */
  router<U extends Router<T, TCurrentContext>>(
    router: U): EnhancedRouter<U, TInitialContext, TCurrentContext, Record<never, never>>

  /**
   * Create a lazy router
   * And applies all of the previously defined options to the specified router.
   * And enforces the router match the contract.
   *
   * @see {@link https://orpc.unnoq.com/docs/router#extending-router Extending Router Docs}
   */
  lazy<U extends Router<T, TInitialContext>>(
    loader: () => Promise<{ default: U }>
  ): EnhancedRouter<Lazy<U>, TInitialContext, TCurrentContext, Record<never, never>>
}

export type ImplementerInternalWithMiddlewares<
  TContract extends AnyContractRouter,
  TInitialContext extends Context,
  TCurrentContext extends Context,
> = TContract extends ContractProcedure<infer UInputSchema, infer UOutputSchema, infer UErrorMap, infer UMeta>
  ? ProcedureImplementer<TInitialContext, TCurrentContext, UInputSchema, UOutputSchema, UErrorMap, UMeta>
  : RouterImplementerWithMiddlewares<TContract, TInitialContext, TCurrentContext> & {
    [K in keyof TContract]: TContract[K] extends AnyContractRouter
      ? ImplementerInternalWithMiddlewares<TContract[K], TInitialContext, TCurrentContext>
      : never
  }
