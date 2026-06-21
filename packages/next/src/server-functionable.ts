import type { AnyORPCError, AnySchema, Context, ErrorMap, Procedure, ProcedureClientOptions, Schema } from '@orpc/server'
import type { MaybeOptionalOptions } from '@orpc/shared'
import type { ProcedureServerFunction } from './server-function'
import { resolveMaybeOptionalOptions } from '@orpc/shared'
import { createServerFunction } from './server-function'

export interface ServerFunctionable<TInitialContext extends Context> {
  <
    TInjectedContext extends Context,
    TInputSchema extends AnySchema,
    TOutputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
    TReturnedError extends AnyORPCError,
  >(
    procedure: Procedure<TInitialContext, TInjectedContext, TInputSchema, TOutputSchema, TErrorMap, TReturnedError>
  ):
    & ProcedureServerFunction<TInputSchema, TOutputSchema, TErrorMap, TReturnedError>
    & Procedure<TInitialContext, TInjectedContext, TInputSchema, TOutputSchema, TErrorMap, TReturnedError>
}

export function createServerFunctionable<TInitialContext extends Context = object>(
  ...rest: MaybeOptionalOptions<
    ProcedureClientOptions<
      TInitialContext,
      Schema<unknown>,
      ErrorMap,
      any,
      object
    >
  >
): ServerFunctionable<TInitialContext> {
  const options = resolveMaybeOptionalOptions(rest)

  return <
    TInjectedContext extends Context,
    TInputSchema extends AnySchema,
    TOutputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
    TReturnedError extends AnyORPCError,
  >(
    procedure: Procedure<TInitialContext, TInjectedContext, TInputSchema, TOutputSchema, TErrorMap, TReturnedError>,
  ) => {
    const functionable = createServerFunction(
      procedure,
      options,
    ) as
    & ProcedureServerFunction<TInputSchema, TOutputSchema, TErrorMap, TReturnedError>
    & Procedure<TInitialContext, TInjectedContext, TInputSchema, TOutputSchema, TErrorMap, TReturnedError>

    functionable['~orpc'] = procedure['~orpc']

    return functionable
  }
}
