import type { AnyORPCError, AnySchema, Context, ErrorMap, Procedure, ProcedureClientOptions, Schema } from '@orpc/server'
import type { MaybeOptionalOptions } from '@orpc/shared'
import type { ServerFormFunction } from './server-form-function'
import { resolveMaybeOptionalOptions } from '@orpc/shared'
import { createServerFormFunction } from './server-form-function'

export interface ServerFormFunctionable<TInitialContext extends Context> {
  <
    TInjectedContext extends Context,
    TInputSchema extends AnySchema,
    TOutputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
    TReturnedError extends AnyORPCError,
  >(
    procedure: Procedure<TInitialContext, TInjectedContext, TInputSchema, TOutputSchema, TErrorMap, TReturnedError>
  ):
    & ServerFormFunction
    & Procedure<TInitialContext, TInjectedContext, TInputSchema, TOutputSchema, TErrorMap, TReturnedError>
}

export function createServerFormFunctionable<TInitialContext extends Context = object>(
  ...rest: MaybeOptionalOptions<
    ProcedureClientOptions<
      TInitialContext,
      Schema<unknown>,
      ErrorMap,
      any,
      object
    >
  >
): ServerFormFunctionable<TInitialContext> {
  const options = resolveMaybeOptionalOptions(rest)

  return <
    TInjectedContext extends Context,
    TInputSchema extends AnySchema,
    TOutputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
    TReturnedError extends AnyORPCError,
  >(
    procedure: Procedure<
      TInitialContext,
      TInjectedContext,
      TInputSchema,
      TOutputSchema,
      TErrorMap,
      TReturnedError
    >,
  ) => {
    const functionable = createServerFormFunction(
      procedure,
      options,
    ) as
    & ServerFormFunction
    & Procedure<TInitialContext, TInjectedContext, TInputSchema, TOutputSchema, TErrorMap, TReturnedError>

    functionable['~orpc'] = procedure['~orpc']

    return functionable
  }
}
