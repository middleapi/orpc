import type { AnyORPCError, AnySchema, Context, ErrorMap, Lazyable, Procedure, ProcedureClientOptions } from '@orpc/server'
import type { MaybeOptionalOptions } from '@orpc/shared'
import { BracketNotationSerializer } from '@orpc/openapi'
import { createProcedureClient } from '@orpc/server'
import { resolveMaybeOptionalOptions } from '@orpc/shared'

export interface ServerFormFunction {
  (form: FormData): Promise<void>
}

export function createServerFormFunction<
  TInitialContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TReturnedError extends AnyORPCError,
>(
  procedure: Lazyable<Procedure<
    TInitialContext,
    any,
    TInputSchema,
    TOutputSchema,
    TErrorMap,
    TReturnedError
  >>,
  ...rest: MaybeOptionalOptions<
    ProcedureClientOptions<
      TInitialContext,
      TOutputSchema,
      TErrorMap,
      TReturnedError,
      object
    >
  >
): ServerFormFunction {
  const options = resolveMaybeOptionalOptions(rest)
  const client = createProcedureClient(procedure, options)
  const serializer = new BracketNotationSerializer()

  return async (form) => {
    const input = serializer.deserialize([...form])
    await client(input as any)
  }
}
