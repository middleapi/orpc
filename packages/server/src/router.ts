import type { AnyContractRouter, ContractProcedure, InferSchemaInput, InferSchemaOutput } from '@orpc/contract'
import type { Context } from './context'
import type { Lazyable } from './lazy'
import type { Procedure } from './procedure'

/**
 * Represents a router, which defines a hierarchical structure of procedures.
 *
 * @info A procedure is a router too.
 * @see {@link https://orpc.unnoq.com/docs/contract-first/define-contract#contract-router Contract Router Docs}
 */
export type Router<T extends AnyContractRouter, TInitialContext extends Context>
  = T extends ContractProcedure<infer UInputSchema, infer UOutputSchema, infer UErrorMap, infer UMeta>
    ? Procedure<TInitialContext, any, UInputSchema, UOutputSchema, UErrorMap, UMeta>
    : {
        [K in keyof T]: T[K] extends AnyContractRouter ? Lazyable<Router<T[K], TInitialContext>> : never
      }

export type AnyRouter = Router<any, any>

export type InferRouterInitialContext<T extends AnyRouter> = T extends Router<any, infer UInitialContext>
  ? UInitialContext
  : never

/**
 * Infer all initial context of the router.
 *
 * @info A procedure is a router too.
 * @see {@link https://orpc.unnoq.com/docs/router#utilities Router Utilities Docs}
 */
export type InferRouterInitialContexts<T extends AnyRouter>
  = T extends Procedure<infer UInitialContext, any, any, any, any, any>
    ? UInitialContext
    : {
        [K in keyof T]: T[K] extends Lazyable<infer U extends AnyRouter> ? InferRouterInitialContexts<U> : never
      }

/**
 * Infer all current context of the router.
 *
 * @info A procedure is a router too.
 * @see {@link https://orpc.unnoq.com/docs/router#utilities Router Utilities Docs}
 */
export type InferRouterCurrentContexts<T extends AnyRouter>
  = T extends Procedure<any, infer UCurrentContext, any, any, any, any>
    ? UCurrentContext
    : {
        [K in keyof T]: T[K] extends Lazyable<infer U extends AnyRouter> ? InferRouterCurrentContexts<U> : never
      }

/**
 * Infer all router inputs
 *
 * @info A procedure is a router too.
 * @see {@link https://orpc.unnoq.com/docs/router#utilities Router Utilities Docs}
 */
export type InferRouterInputs<T extends AnyRouter>
  = T extends Procedure<any, any, infer UInputSchema, any, any, any>
    ? InferSchemaInput<UInputSchema>
    : {
        [K in keyof T]: T[K] extends Lazyable<infer U extends AnyRouter> ? InferRouterInputs<U> : never
      }

/**
 * Infer all router outputs
 *
 * @info A procedure is a router too.
 * @see {@link https://orpc.unnoq.com/docs/router#utilities Router Utilities Docs}
 */
export type InferRouterOutputs<T extends AnyRouter>
  = T extends Procedure<any, any, any, infer UOutputSchema, any, any>
    ? InferSchemaOutput<UOutputSchema>
    : {
        [K in keyof T]: T[K] extends Lazyable<infer U extends AnyRouter> ? InferRouterOutputs<U> : never
      }
