import type {
  AnyProcedureContractLike,
  InferSchemaInput,
  InferSchemaOutput,
  ORPCErrorFromErrorMap,
  ProcedureContractErrorMapOf,
  ProcedureContractInputSchemaOf,
  ProcedureContractOutputSchemaOf,
  RouterContract,
  ThrowableError,
} from '@orpc/contract'

import type { Context, MergedContext } from './context'
import type { Lazy, Lazyable } from './lazy'
import type { AnyProcedureLike, Procedure, ProcedureDefinition } from './procedure'

export type Router<TInitialContext extends Context> =
  | Procedure<TInitialContext, any, any, any, any>
  | {
      [k: string]: Lazyable<Router<TInitialContext>>
    }

export type ContractedRouter<
  T extends RouterContract,
  TInitialContext extends Context,
> = ContractedRouterInternal<T, TInitialContext>

export type ContractedRouterInternal<
  T,
  TInitialContext extends Context,
> = T extends AnyProcedureContractLike
  ? Procedure<
      TInitialContext,
      any,
      ProcedureContractInputSchemaOf<T>,
      ProcedureContractOutputSchemaOf<T>,
      ProcedureContractErrorMapOf<T>
    >
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
 * Infer all current context of the router.
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

export type InferRouterInputsInternal<T> = T extends AnyProcedureLike
  ? InferSchemaInput<ProcedureContractInputSchemaOf<T>>
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

export type InferRouterOutputsInternal<T> = T extends AnyProcedureLike
  ? InferSchemaOutput<ProcedureContractOutputSchemaOf<T>>
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

export type InferRouterErrorInternal<T> = T extends AnyProcedureLike
  ? ORPCErrorFromErrorMap<ProcedureContractErrorMapOf<T>> | ThrowableError
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

export type InferRouterErrorsInternal<T> = T extends AnyProcedureLike
  ? ORPCErrorFromErrorMap<ProcedureContractErrorMapOf<T>> | ThrowableError
  : T extends Lazy<infer U>
    ? InferRouterErrorsInternal<U>
    : {
        [K in keyof T]: InferRouterErrorsInternal<T[K] & {}>
      }
