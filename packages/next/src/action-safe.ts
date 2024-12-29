import type { Schema, SchemaInput, SchemaOutput } from '@orpc/contract'
import type { Context, CreateProcedureClientOptions, ProcedureClient, WELL_ORPC_ERROR_JSON } from '@orpc/server'
import { createProcedureClient, ORPCError } from '@orpc/server'

export type SafeAction<TInput, TOutput,
> = ProcedureClient<
  TInput,
  | [TOutput, undefined, 'success']
  | [undefined, WELL_ORPC_ERROR_JSON, 'error'],
  unknown
>

export function createSafeAction<
  TContext extends Context,
  TInputSchema extends Schema,
  TOutputSchema extends Schema,
  THandlerOutput extends SchemaInput<TOutputSchema>,
>(
  opt: CreateProcedureClientOptions<TContext, TInputSchema, TOutputSchema, THandlerOutput>,
): SafeAction<SchemaInput<TInputSchema>, SchemaOutput<TOutputSchema, THandlerOutput>> {
  const caller = createProcedureClient(opt)

  const safeAction: SafeAction<SchemaInput<TInputSchema>, SchemaOutput<TOutputSchema, THandlerOutput>> = async (...[input, option]) => {
    try {
      const output = await caller(input as any, option as any)
      return [output as any, undefined, 'success']
    }
    catch (e) {
      const error = convertToORPCError(e)

      return [undefined, error.toJSON(), 'error']
    }
  }

  return safeAction as any
}

function convertToORPCError(e: unknown): ORPCError<any, any> {
  if (e instanceof ORPCError) {
    return e
  }

  return new ORPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Internal server error',
    cause: e,
  })
}
