import type { AnyContractRouter, ContractProcedure, InferContractRouterErrorMap, InferContractRouterMeta } from '@orpc/contract'
import type { AnyFunction, IntersectPick } from '@orpc/shared'
import type { BuilderConfig } from './builder'
import type { Context, MergedCurrentContext, MergedInitialContext } from './context'
import type { ORPCErrorConstructorMap } from './error'
import type { ProcedureImplementer } from './implementer-procedure'
import type { ImplementerInternalWithMiddlewares } from './implementer-variants'
import type { Lazy } from './lazy'
import type { AnyMiddleware, Middleware } from './middleware'
import type { DecoratedMiddleware } from './middleware-decorated'
import type { AnyRouter, Router } from './router'
import type { EnhancedRouter } from './router-utils'
import { getContractRouter, isContractProcedure } from '@orpc/contract'
import { Builder } from './builder'
import { fallbackConfig } from './config'
import { lazy } from './lazy'
import { decorateMiddleware } from './middleware-decorated'
import { addMiddleware } from './middleware-utils'
import { setHiddenRouterContract } from './router-hidden'
import { enhanceRouter } from './router-utils'

export interface RouterImplementer<
  T extends AnyContractRouter,
  TInitialContext extends Context,
  TCurrentContext extends Context,
> {
  /**
   * Creates a middleware.
   *
   * @see {@link https://orpc.unnoq.com/docs/middleware Middleware Docs}
   */
  middleware<UOutContext extends IntersectPick<TCurrentContext, UOutContext>, TInput, TOutput = any>( // = any here is important to make middleware can be used in any output by default
    middleware: Middleware<
      TInitialContext,
      UOutContext,
      TInput,
      TOutput,
      ORPCErrorConstructorMap<InferContractRouterErrorMap<T>>,
      InferContractRouterMeta<T>
    >,
  ): DecoratedMiddleware<TInitialContext, UOutContext, TInput, TOutput, any, InferContractRouterMeta<T>> // any ensures middleware can used in any procedure

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
    router: U
  ): EnhancedRouter<U, TInitialContext, TCurrentContext, Record<never, never>>

  /**
   * Create a lazy router
   * And applies all of the previously defined options to the specified router.
   * And enforces the router match the contract.
   *
   * @see {@link https://orpc.unnoq.com/docs/router#extending-router Extending Router Docs}
   */
  lazy<U extends Router<T, TCurrentContext>>(
    loader: () => Promise<{ default: U }>
  ): EnhancedRouter<Lazy<U>, TInitialContext, TCurrentContext, Record<never, never>>
}

export type ImplementerInternal<
  TContract extends AnyContractRouter,
  TInitialContext extends Context,
  TCurrentContext extends Context,
> = TContract extends ContractProcedure<infer UInputSchema, infer UOutputSchema, infer UErrorMap, infer UMeta>
  ? ProcedureImplementer<TInitialContext, TCurrentContext, UInputSchema, UOutputSchema, UErrorMap, UMeta>
  : RouterImplementer<TContract, TInitialContext, TCurrentContext> & {
    [K in keyof TContract]: TContract[K] extends AnyContractRouter
      ? ImplementerInternal<TContract[K], TInitialContext, TCurrentContext>
      : never
  }

export function implementerInternal<
  T extends AnyContractRouter,
  TInitialContext extends Context,
  TCurrentContext extends Context,
>(
  contract: T,
  config: BuilderConfig,
  middlewares: AnyMiddleware[],
): ImplementerInternal<T, TInitialContext, TCurrentContext> {
  if (isContractProcedure(contract)) {
    const impl = new Builder({
      ...contract['~orpc'],
      config,
      middlewares,
      inputValidationIndex: fallbackConfig('initialInputValidationIndex', config?.initialInputValidationIndex) + middlewares.length,
      outputValidationIndex: fallbackConfig('initialOutputValidationIndex', config?.initialOutputValidationIndex) + middlewares.length,
      dedupeLeadingMiddlewares: fallbackConfig('dedupeLeadingMiddlewares', config.dedupeLeadingMiddlewares),
    })

    return impl as any
  }

  const impl = new Proxy(contract, {
    get: (target, key) => {
      if (typeof key !== 'string') {
        return Reflect.get(target, key)
      }

      let method: AnyFunction | undefined

      if (key === 'middleware') {
        method = (mid: any) => decorateMiddleware(mid)
      }
      else if (key === 'use') {
        method = (mid: any) => {
          return implementerInternal(
            contract,
            config,
            addMiddleware(middlewares, mid),
          )
        }
      }
      else if (key === 'router') {
        method = (router: any) => {
          const adapted = enhanceRouter(router, {
            middlewares,
            errorMap: {},
            prefix: undefined,
            tags: undefined,
            dedupeLeadingMiddlewares: fallbackConfig('dedupeLeadingMiddlewares', config.dedupeLeadingMiddlewares),
          })

          return setHiddenRouterContract(adapted, contract)
        }
      }
      else if (key === 'lazy') {
        method = (loader: () => Promise<{ default: AnyRouter }>) => {
          const adapted = enhanceRouter(lazy(loader) as any, {
            middlewares,
            errorMap: {},
            prefix: undefined,
            tags: undefined,
            dedupeLeadingMiddlewares: fallbackConfig('dedupeLeadingMiddlewares', config.dedupeLeadingMiddlewares),
          })

          return setHiddenRouterContract(adapted, contract)
        }
      }

      const next = getContractRouter(target, [key])

      if (!next) {
        return method ?? next
      }

      const nextImpl = implementerInternal(next, config, middlewares)

      if (method) {
        return new Proxy(method, {
          get(_, key) {
            return Reflect.get(nextImpl, key)
          },
        })
      }

      return nextImpl
    },
  })

  return impl as any
}

export type Implementer<
  TContract extends AnyContractRouter,
  TInitialContext extends Context,
  TCurrentContext extends Context,
>
  = & {
    /**
     * Set or override the initial context.
     *
     * @see {@link https://orpc.unnoq.com/docs/context Context Docs}
     */
    $context<U extends Context>(): Implementer<TContract, U & Record<never, never>, U> // We need `& Record<never, never>` to deal with `has no properties in common with type` error

    /**
     * Sets or overrides the config.
     *
     * @see {@link https://orpc.unnoq.com/docs/lifecycle#middlewares-order Middlewares Order Docs}
     * @see {@link https://orpc.unnoq.com/docs/best-practices/dedupe-middleware#configuration Dedupe Middleware Docs}
     */
    $config(config: BuilderConfig): Implementer<TContract, TInitialContext, TCurrentContext>
  }
  & ImplementerInternal<TContract, TInitialContext, TCurrentContext>

export function implement<T extends AnyContractRouter, TContext extends Context = Record<never, never>>(
  contract: T,
  config: BuilderConfig = {},
): Implementer<T, TContext, TContext> {
  const implInternal = implementerInternal(contract, config, [])

  const impl = new Proxy(implInternal, {
    get: (target, key) => {
      let method: AnyFunction | undefined

      if (key === '$context') {
        method = () => impl
      }
      else if (key === '$config') {
        method = (config: BuilderConfig) => implement(contract, config)
      }

      const next = Reflect.get(target, key)

      if (!method || !next || (typeof next !== 'function' && typeof next !== 'object')) {
        return method || next
      }

      return new Proxy(method, {
        get(_, key) {
          return Reflect.get(next, key)
        },
      })
    },
  })

  return impl as any
}
