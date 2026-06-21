import type { AnyORPCError, ClientContext } from '@orpc/client'
import type { AnySchema, ErrorMap } from '@orpc/contract'
import type { MaybeOptionalOptions } from '@orpc/shared'
import type { Context } from '../context'
import type { Procedure } from '../procedure'
import type { ProcedureClient, ProcedureClientOptions } from '../procedure-client'
import { createProcedureClient } from '../procedure-client'
import { DecoratedProcedure } from '../procedure-decorated'

declare module '../procedure-decorated' {
  interface DecoratedProcedure<
    TInitialContext extends Context,
    TInjectedContext extends Context,
    TInputSchema extends AnySchema,
    TOutputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
    TReturnedError extends AnyORPCError,
  > {
    callable<TClientContext extends ClientContext>(
      ...rest: MaybeOptionalOptions<
        ProcedureClientOptions<
          TInitialContext,
          TOutputSchema,
          TErrorMap,
          TReturnedError,
          TClientContext
        >
      >
    ): Procedure<TInitialContext, TInjectedContext, TInputSchema, TOutputSchema, TErrorMap, TReturnedError>
      & ProcedureClient<TClientContext, TInputSchema, TOutputSchema, TErrorMap, TReturnedError>
  }
}

DecoratedProcedure.prototype.callable = function callable(...rest) {
  const callable = createProcedureClient(this, ...rest) as any
  callable['~orpc'] = this['~orpc']
  return callable
}
