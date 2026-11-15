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
> = T extends unknown ? ContractedRouterImpl<T, TInitialContext> : never

// Recurses without re-checking each key against the constraint. `T[K] & {}` drops `undefined`
// from optional keys and keeps TypeScript from inferring `T` back through this mapped type. The
// public type wraps it in `T extends unknown ? ... : never` so emitted declarations name the
// public type instead of inlining this one.
type ContractedRouterImpl<T, TInitialContext extends Context> =
  T extends ProcedureContract<infer $InputSchema, infer $OutputSchema, infer $ErrorMap>
    ? Procedure<TInitialContext, any, $InputSchema, $OutputSchema, $ErrorMap>
    : {
        [K in keyof T]: Lazyable<ContractedRouterImpl<T[K] & {}, TInitialContext>>
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
export type InferRouterInitialContexts<T extends AnyRouter> = T extends unknown
  ? InferRouterInitialContextsImpl<T>
  : never

type InferRouterInitialContextsImpl<T> = T extends {
  '~orpc': ProcedureDefinition<infer UInitialContext, any, any, any, any>
}
  ? UInitialContext
  : T extends Lazy<infer U>
    ? InferRouterInitialContextsImpl<U>
    : {
        [K in keyof T]: InferRouterInitialContextsImpl<T[K] & {}>
      }

/**
 * Infer all current context of the router.
 *
 * @remarks
 * **Note**: A procedure is a router too.
 *
 * @see {@link https://orpc.dev/docs/router#infer-router-final-contexts | Router - Infer Router Final Contexts}
 */
export type InferRouterFinalContexts<T extends AnyRouter> = T extends unknown
  ? InferRouterFinalContextsImpl<T>
  : never

type InferRouterFinalContextsImpl<T> = T extends {
  '~orpc': ProcedureDefinition<infer UInitialContext, infer UInjectedContext, any, any, any>
}
  ? MergedContext<UInitialContext, UInjectedContext>
  : T extends Lazy<infer U>
    ? InferRouterFinalContextsImpl<U>
    : {
        [K in keyof T]: InferRouterFinalContextsImpl<T[K] & {}>
      }

/**
 * Infer all router inputs.
 *
 * @remarks
 * **Note**: A procedure is a router too.
 *
 * @see {@link https://orpc.dev/docs/router#infer-router-inputs | Router - Infer Router Inputs}
 */
export type InferRouterInputs<T extends AnyRouter> = T extends unknown
  ? InferRouterInputsImpl<T>
  : never

type InferRouterInputsImpl<T> = T extends {
  '~orpc': ProcedureDefinition<any, any, infer UInputSchema, any, any>
}
  ? InferSchemaInput<UInputSchema>
  : T extends Lazy<infer U>
    ? InferRouterInputsImpl<U>
    : {
        [K in keyof T]: InferRouterInputsImpl<T[K] & {}>
      }

/**
 * Infer all router outputs.
 *
 * @remarks
 * **Note**: A procedure is a router too.
 *
 * @see {@link https://orpc.dev/docs/router#infer-router-outputs | Router - Infer Router Outputs}
 */
export type InferRouterOutputs<T extends AnyRouter> = T extends unknown
  ? InferRouterOutputsImpl<T>
  : never

type InferRouterOutputsImpl<T> = T extends {
  '~orpc': ProcedureDefinition<any, any, any, infer UOutputSchema, any>
}
  ? InferSchemaOutput<UOutputSchema>
  : T extends Lazy<infer U>
    ? InferRouterOutputsImpl<U>
    : {
        [K in keyof T]: InferRouterOutputsImpl<T[K] & {}>
      }

/**
 * Infer the union of throwable errors for entire router.
 *
 * @see {@link https://orpc.dev/docs/router#infer-router-error | Router - Infer Router Error}
 */
export type InferRouterError<T extends AnyRouter> = T extends unknown
  ? InferRouterErrorImpl<T>
  : never

type InferRouterErrorImpl<T> = T extends {
  '~orpc': ProcedureDefinition<any, any, any, any, infer UErrorMap>
}
  ? ORPCErrorFromErrorMap<UErrorMap> | ThrowableError
  : T extends Lazy<infer U>
    ? InferRouterErrorImpl<U>
    : {
        [K in keyof T]-?: InferRouterErrorImpl<T[K] & {}>
      }[keyof T]

/**
 * Infer throwable errors for each procedure, preserving the router shape.
 *
 * @see {@link https://orpc.dev/docs/router#infer-router-errors | Router - Infer Router Errors}
 */
export type InferRouterErrors<T extends AnyRouter> = T extends unknown
  ? InferRouterErrorsImpl<T>
  : never

type InferRouterErrorsImpl<T> = T extends {
  '~orpc': ProcedureDefinition<any, any, any, any, infer UErrorMap>
}
  ? ORPCErrorFromErrorMap<UErrorMap> | ThrowableError
  : T extends Lazy<infer U>
    ? InferRouterErrorsImpl<U>
    : {
        [K in keyof T]: InferRouterErrorsImpl<T[K] & {}>
      }
