import type { Client, ORPCError, ORPCErrorJSON } from '@orpc/client'
import type { AnySchema, ErrorFromErrorMap, ErrorMap, InferSchemaInput, InferSchemaOutput } from '@orpc/contract'
import type { ThrowableError } from '@orpc/shared'
import { toORPCError } from '@orpc/client'
import { isObject } from '@orpc/shared'

export type ActionableError<T> = T extends ORPCError<infer U, infer V> ? ORPCErrorJSON<U, V> & { defined: true } : ORPCErrorJSON<string, unknown> & { defined: false }

export type UnactionableError<T> = T extends { defined: true } & ORPCErrorJSON<infer U, infer V> ? ORPCError<U, V> : ThrowableError

export type ActionableClientRest<TInput>
  = | [input: TInput]
    | (undefined extends TInput ? [input?: TInput] : [input: TInput])

export type ActionableClientResult<TOutput, TError extends ORPCErrorJSON<any, any>> = [error: null, data: TOutput] | [error: TError, data: undefined]

export interface ActionableClient<TInput, TOutput, TError extends ORPCErrorJSON<any, any>> {
  (...rest: ActionableClientRest<TInput>): Promise<ActionableClientResult<TOutput, TError>>
}

export type ProcedureActionableClient<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
> = ActionableClient<
  InferSchemaInput<TInputSchema>,
  InferSchemaOutput<TOutputSchema>,
  ActionableError<ErrorFromErrorMap<TErrorMap>>
>

export function createActionableClient<TInput, TOutput, TError>(
  client: Client<Record<never, never>, TInput, TOutput, TError>,
): ActionableClient<TInput, TOutput, ActionableError<TError>> {
  const action = async (input: TInput) => {
    try {
      return [null, await client(input)]
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

      // special tanstack router errors
      if (
        (error instanceof Response && 'options' in error && isObject(error.options))
        || (isObject(error) && error.isNotFound === true)
      ) {
        throw error
      }

      return [toORPCError(error).toJSON(), undefined]
    }
  }

  return action as any
}
