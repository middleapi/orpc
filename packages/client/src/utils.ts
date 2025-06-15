import type { ThrowableError } from '@orpc/shared'
import type { ORPCError } from './error'
import type { ClientContext, ClientOptions, ClientPromiseResult, FriendlyClientOptions } from './types'
import { isDefinedError } from './error'

export type SafeResult<TOutput, TError>
  = | [error: null, data: TOutput, isDefined: false, isSuccess: true]
  & { error: null, data: TOutput, isDefined: false, isSuccess: true }
  | [error: Exclude<TError, ORPCError<any, any>>, data: undefined, isDefined: false, isSuccess: false]
  & { error: Exclude<TError, ORPCError<any, any>>, data: undefined, isDefined: false, isSuccess: false }
  | [error: Extract<TError, ORPCError<any, any>>, data: undefined, isDefined: true, isSuccess: false]
  & { error: Extract<TError, ORPCError<any, any>>, data: undefined, isDefined: true, isSuccess: false }

/**
 * Works like try/catch, but can infer error types.
 *
 * @info support both tuple `[error, data, isDefined, isSuccess]` and object `{ error, data, isDefined, isSuccess }` styles.
 * @see {@link https://orpc.unnoq.com/docs/client/error-handling Client Error Handling Docs}
 */
export async function safe<TOutput, TError = ThrowableError>(promise: ClientPromiseResult<TOutput, TError>): Promise<SafeResult<TOutput, TError>> {
  try {
    const output = await promise
    return Object.assign(
      [null, output, false, true] satisfies [null, TOutput, false, true],
      { error: null, data: output, isDefined: false as const, isSuccess: true as const },
    )
  }
  catch (e) {
    const error = e as TError

    if (isDefinedError(error)) {
      return Object.assign(
        [error, undefined, true, false] satisfies [typeof error, undefined, true, false],
        { error, data: undefined, isDefined: true as const, isSuccess: false as const },
      )
    }

    return Object.assign(
      [error as Exclude<TError, ORPCError<any, any>>, undefined, false, false] satisfies [Exclude<TError, ORPCError<any, any>>, undefined, false, false],
      { error: error as Exclude<TError, ORPCError<any, any>>, data: undefined, isDefined: false as const, isSuccess: false as const },
    )
  }
}

export function resolveFriendlyClientOptions<T extends ClientContext>(options: FriendlyClientOptions<T>): ClientOptions<T> {
  return {
    ...options,
    context: options.context ?? {} as T, // Context only optional if all fields are optional
  }
}
