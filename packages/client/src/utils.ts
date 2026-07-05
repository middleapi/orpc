import type { PromiseWithError, ThrowableError } from '@orpc/shared'
import type { AnyORPCError } from './error'
import type { ClientContext, ClientOptions, ClientRest, FriendlyClientOptions } from './types'
import { isInferableError } from './error-utils'

export function resolveFriendlyClientOptions<T extends ClientContext>(options: FriendlyClientOptions<T>): ClientOptions<T> {
  return {
    ...options,
    context: options.context ?? {} as T, // Context only optional if all fields are optional
  }
}

export function resolveClientRest<TClientContext extends ClientContext, TInput>(rest: ClientRest<TClientContext, TInput>): [input: TInput, options: ClientOptions<TClientContext>] {
  return [
    rest[0] as TInput, // rest[0] can be undefined if TInput is optional,
    resolveFriendlyClientOptions(rest[1] ?? {} as FriendlyClientOptions<TClientContext>), // rest[1] can be undefined if all fields of FriendlyClientOptions are optional
  ]
}

export type SafeResult<TOutput, TError>
  = | [error: null, data: TOutput, inferableError: null, isSuccess: true]
  & { error: null, data: TOutput, inferableError: null, isSuccess: true }
  | [error: Exclude<TError, AnyORPCError>, data: undefined, inferableError: null, isSuccess: false]
  & { error: Exclude<TError, AnyORPCError>, data: undefined, inferableError: null, isSuccess: false }
  | [error: Extract<TError, AnyORPCError>, data: undefined, inferableError: Extract<TError, AnyORPCError>, isSuccess: false]
  & { error: Extract<TError, AnyORPCError>, data: undefined, inferableError: Extract<TError, AnyORPCError>, isSuccess: false }

/**
 * Works like try/catch, but help you infer the error type if it is inferable ORPCError.
 *
 * @example
 * ```ts
 * const [error, data, inferableError, isSuccess] = await safe(client(...))
 * // or const { error, data, inferableError, isSuccess } = await safe(client(...))
 *
 * if (inferableError) {
 *  console.log(inferableError) // or error, both are well typed
 * }
 */
export async function safe<TOutput, TError = ThrowableError>(promise: PromiseWithError<TOutput, TError>): Promise<SafeResult<TOutput, TError>> {
  try {
    const output = await promise
    return Object.assign(
      [null, output, null, true] satisfies [null, TOutput, null, true],
      { error: null, data: output, inferableError: null, isSuccess: true as const },
    )
  }
  catch (e) {
    const error = e as TError

    if (isInferableError(error)) {
      return Object.assign(
        [error, undefined, error, false] satisfies [typeof error, undefined, typeof error, false],
        { error, data: undefined, inferableError: error, isSuccess: false as const },
      )
    }

    return Object.assign(
      [error as Exclude<TError, AnyORPCError>, undefined, null, false] satisfies [Exclude<TError, AnyORPCError>, undefined, null, false],
      { error: error as Exclude<TError, AnyORPCError>, data: undefined, inferableError: null, isSuccess: false as const },
    )
  }
}
