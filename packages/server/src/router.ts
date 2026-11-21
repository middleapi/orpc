import type {
  InferSchemaInput,
  InferSchemaOutput,
  ORPCErrorFromErrorMap,
  ProcedureContract,
  RouterContract,
  ThrowableError,
} from '@orpc/contract'

import type { Context, MergedContext } from './context'
import type { Lazy, Lazyable } from './lazy'
import type { Procedure, ProcedureDefinition } from './procedure'

export type Router<TInitialContext extends Context> =
  | Procedure<TInitialContext, any, any, any, any>
  | {
      [k: string]: Lazyable<Router<TInitialContext>>
    }

export type ContractedRouter<
  T extends RouterContract,
  TInitialContext extends Context,
> = ContractedRouterInternal<T, TInitialContext>

export type ContractedRouterInternal<T, TInitialContext extends Context> =
  T extends ProcedureContract<infer $InputSchema, infer $OutputSchema, infer $ErrorMap>
    ? Procedure<TInitialContext, any, $InputSchema, $OutputSchema, $ErrorMap>
    : {
        [K in keyof T]: Lazyable<ContractedRouterInternal<T[K] & {}, TInitialContext>>
      }

export type AnyRouter = Router<any>

export type InferRouterInitialContext<T extends AnyRouter> = T extends Router<infer $> ? $ : never

/**
 * Infer all initial context of the router.
 *
 * @remarks
 * **Note**: A procedure is a router too.
 *
 * @see {@link https://orpc.dev/docs/router#infer-router-initial-contexts | Router - Infer Router Initial Contexts}
 */
export type InferRouterInitialContexts<T extends AnyRouter> = InferRouterInitialContextsInternal<T>

export type InferRouterInitialContextsInternal<T> = T extends {
  '~orpc': ProcedureDefinition<infer UInitialContext, any, any, any, any>
}
  ? UInitialContext
  : T extends Lazy<infer U>
    ? InferRouterInitialContextsInternal<U>
    : {
        [K in keyof T]: InferRouterInitialContextsInternal<T[K] & {}>
      }

/**
 * Infer all final contexts of the router.
 *
 * @remarks
 * **Note**: A procedure is a router too.
 *
 * @see {@link https://orpc.dev/docs/router#infer-router-final-contexts | Router - Infer Router Final Contexts}
 */
export type InferRouterFinalContexts<T extends AnyRouter> = InferRouterFinalContextsInternal<T>

export type InferRouterFinalContextsInternal<T> = T extends {
  '~orpc': ProcedureDefinition<infer UInitialContext, infer UInjectedContext, any, any, any>
}
  ? MergedContext<UInitialContext, UInjectedContext>
  : T extends Lazy<infer U>
    ? InferRouterFinalContextsInternal<U>
    : {
        [K in keyof T]: InferRouterFinalContextsInternal<T[K] & {}>
      }

/**
 * Infer all router inputs.
 *
 * @remarks
 * **Note**: A procedure is a router too.
 *
 * @see {@link https://orpc.dev/docs/router#infer-router-inputs | Router - Infer Router Inputs}
 */
export type InferRouterInputs<T extends AnyRouter> = InferRouterInputsInternal<T>

export type InferRouterInputsInternal<T> = T extends {
  '~orpc': ProcedureDefinition<any, any, infer UInputSchema, any, any>
}
  ? InferSchemaInput<UInputSchema>
  : T extends Lazy<infer U>
    ? InferRouterInputsInternal<U>
    : {
        [K in keyof T]: InferRouterInputsInternal<T[K] & {}>
      }

/**
 * Infer all router outputs.
 *
 * @remarks
 * **Note**: A procedure is a router too.
 *
 * @see {@link https://orpc.dev/docs/router#infer-router-outputs | Router - Infer Router Outputs}
 */
export type InferRouterOutputs<T extends AnyRouter> = InferRouterOutputsInternal<T>

export type InferRouterOutputsInternal<T> = T extends {
  '~orpc': ProcedureDefinition<any, any, any, infer UOutputSchema, any>
}
  ? InferSchemaOutput<UOutputSchema>
  : T extends Lazy<infer U>
    ? InferRouterOutputsInternal<U>
    : {
        [K in keyof T]: InferRouterOutputsInternal<T[K] & {}>
      }

/**
 * Infer the union of throwable errors for entire router.
 *
 * @see {@link https://orpc.dev/docs/router#infer-router-error | Router - Infer Router Error}
 */
export type InferRouterError<T extends AnyRouter> = InferRouterErrorInternal<T>

export type InferRouterErrorInternal<T> = T extends {
  '~orpc': ProcedureDefinition<any, any, any, any, infer UErrorMap>
}
  ? ORPCErrorFromErrorMap<UErrorMap> | ThrowableError
  : T extends Lazy<infer U>
    ? InferRouterErrorInternal<U>
    : {
        [K in keyof T]-?: InferRouterErrorInternal<T[K] & {}>
      }[keyof T]

/**
 * Infer throwable errors for each procedure, preserving the router shape.
 *
 * @see {@link https://orpc.dev/docs/router#infer-router-errors | Router - Infer Router Errors}
 */
export type InferRouterErrors<T extends AnyRouter> = InferRouterErrorsInternal<T>

export type InferRouterErrorsInternal<T> = T extends {
  '~orpc': ProcedureDefinition<any, any, any, any, infer UErrorMap>
}
  ? ORPCErrorFromErrorMap<UErrorMap> | ThrowableError
  : T extends Lazy<infer U>
    ? InferRouterErrorsInternal<U>
    : {
        [K in keyof T]: InferRouterErrorsInternal<T[K] & {}>
      }
