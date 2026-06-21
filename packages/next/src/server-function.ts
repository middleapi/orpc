import type { AnyORPCError, AnyORPCErrorJSON, AnySchema, Context, ErrorMap, InferSchemaInput, InferSchemaOutput, Lazyable, ORPCError, ORPCErrorCode, ORPCErrorFromErrorMap, ORPCErrorJSON, Procedure, ProcedureClientOptions, ThrowableError } from '@orpc/server'
import type { MaybeOptionalOptions } from '@orpc/shared'
import { createProcedureClient, toORPCError } from '@orpc/server'
import { resolveMaybeOptionalOptions } from '@orpc/shared'

export type ServerFunctionORPCErrorJSON<T>
  = T extends ORPCError<infer U, infer V>
    ? ORPCErrorJSON<U, V> & { inferable: true }
    : ORPCErrorJSON<ORPCErrorCode, unknown> & { inferable: false }

export type ServerFunctionError<T extends AnyORPCErrorJSON>
  = T extends ORPCErrorJSON<infer U, infer V> & { inferable: true }
    ? ORPCError<U, V>
    : ThrowableError

export type ServerFunctionRest<TInput>
  = | [input: TInput]
    | (undefined extends TInput ? [input?: TInput] : [input: TInput])

export type ServerFunctionResult<TOutput, TError> = [error: null, data: TOutput] | [error: TError, data: undefined]

export interface ServerFunction<TInput, TOutput, TError extends AnyORPCErrorJSON> {
  (...rest: ServerFunctionRest<TInput>): Promise<ServerFunctionResult<TOutput, TError>>
}

export type ProcedureServerFunction<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TReturnedORPCError extends AnyORPCError,
> = ServerFunction<
  InferSchemaInput<TInputSchema>,
  InferSchemaOutput<TOutputSchema>,
  ServerFunctionORPCErrorJSON<ORPCErrorFromErrorMap<TErrorMap> | TReturnedORPCError | ThrowableError>
>

export function createServerFunction<
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
): ProcedureServerFunction<TInputSchema, TOutputSchema, TErrorMap, TReturnedError> {
  const options = resolveMaybeOptionalOptions(rest)
  const client = createProcedureClient(procedure, options)

  return async (...[input]) => {
    try {
      return [null, await client(input as any)]
    }
    catch (error) {
      // special next.js errors
      if (
        error instanceof Error
        && 'digest' in error
        && typeof error.digest === 'string'
        && error.digest.startsWith('NEXT_')
      ) {
        throw error
      }

      return [
        toORPCError(error).toJSON() as ServerFunctionORPCErrorJSON<ORPCErrorFromErrorMap<TErrorMap> | TReturnedError | ThrowableError>,
        undefined,
      ]
    }
  }
}
