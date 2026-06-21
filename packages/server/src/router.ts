import type { InferSchemaInput, InferSchemaOutput, ORPCErrorFromErrorMap, ProcedureContract, RouterContract, ThrowableError } from '@orpc/contract'
import type { Context, MergedContext } from './context'
import type { Lazyable } from './lazy'
import type { Procedure } from './procedure'

export type Router<TInitialContext extends Context>
  = | Procedure<TInitialContext, any, any, any, any, any>
    | {
      [k: string]: Lazyable<Router<TInitialContext>>
    }

export type ContractedRouter<T extends RouterContract, TInitialContext extends Context>
  = T extends ProcedureContract<infer $InputSchema, infer $OutputSchema, infer $ErrorMap>
    ? Procedure<TInitialContext, any, $InputSchema, $OutputSchema, $ErrorMap, never>
    : {
        [K in keyof T]: T[K] extends RouterContract ? Lazyable<ContractedRouter<T[K], TInitialContext>> : never
      }

export type AnyRouter = Router<any>

export type InferRouterInitialContext<T extends AnyRouter> = T extends Router<infer $> ? $ : never

/**
 * Infer all initial context of the router.
 *
 * @info A procedure is a router too.
 * @see {@link https://orpc.dev/docs/router#utilities Router Utilities Docs}
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
 * @see {@link https://orpc.dev/docs/router#utilities Router Utilities Docs}
 */
export type InferRouterFinalContexts<T extends AnyRouter>
  = T extends Procedure<infer UInitialContext, infer UInjectedContext, any, any, any, any>
    ? MergedContext<UInitialContext, UInjectedContext>
    : {
        [K in keyof T]: T[K] extends Lazyable<infer U extends AnyRouter> ? InferRouterFinalContexts<U> : never
      }

/**
 * Infer all router inputs
 *
 * @info A procedure is a router too.
 * @see {@link https://orpc.dev/docs/router#utilities Router Utilities Docs}
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
 * @see {@link https://orpc.dev/docs/router#utilities Router Utilities Docs}
 */
export type InferRouterOutputs<T extends AnyRouter>
  = T extends Procedure<any, any, any, infer UOutputSchema, any, any>
    ? InferSchemaOutput<UOutputSchema>
    : {
        [K in keyof T]: T[K] extends Lazyable<infer U extends AnyRouter> ? InferRouterOutputs<U> : never
      }

/**
 * Infer the union of throwable errors for entire router.
 */
export type InferRouterError<T extends AnyRouter>
  = T extends Procedure<any, any, any, any, infer UErrorMap, infer UReturnedError>
    ? ORPCErrorFromErrorMap<UErrorMap> | UReturnedError | ThrowableError
    : {
        [K in keyof T]: T[K] extends Lazyable<infer U extends AnyRouter> ? InferRouterError<U> : never
      }[keyof T]

/**
 * Infer throwable errors for each procedure, preserving the router shape.
 */
export type InferRouterErrors<T extends AnyRouter>
  = T extends Procedure<any, any, any, any, infer UErrorMap, infer UReturnedError>
    ? ORPCErrorFromErrorMap<UErrorMap> | UReturnedError | ThrowableError
    : {
        [K in keyof T]: T[K] extends Lazyable<infer U extends AnyRouter> ? InferRouterErrors<U> : never
      }
