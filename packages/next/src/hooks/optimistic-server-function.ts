import type { AnyORPCErrorJSON } from '@orpc/client'
import { onStart, toArray } from '@orpc/shared'
import { useMemo, useOptimistic } from 'react'

import type { ServerFunction, ServerFunctionError } from '../server-function.ts'
import type { UseServerFunctionOptions, UseServerFunctionResult } from './server-function.ts'
import { useServerFunction } from './server-function.ts'

export interface UseOptimisticServerFunctionOptions<
  TInput,
  TOutput,
  TError,
  TOptimisticState,
> extends UseServerFunctionOptions<TInput, TOutput, TError> {
  optimisticPassthrough: TOptimisticState
  optimisticReducer: (state: TOptimisticState, input: TInput) => TOptimisticState
}

export type UseOptimisticServerFunctionResult<TInput, TOutput, TError, TOptimisticState> =
  UseServerFunctionResult<TInput, TOutput, TError> & {
    optimisticState: TOptimisticState
  }

/**
 * Like `useServerFunction`, but additionally applies optimistic state updates
 * while the server function executes.
 *
 * @see {@link https://orpc.dev/docs/integrations/next#hooks | Next.js Integration - Hooks}
 */
export function useOptimisticServerFunction<
  TInput,
  TOutput,
  TError extends AnyORPCErrorJSON,
  TOptimisticState,
>(
  fn: ServerFunction<TInput, TOutput, TError>,
  options: UseOptimisticServerFunctionOptions<
    TInput,
    TOutput,
    ServerFunctionError<TError>,
    TOptimisticState
  >,
): UseOptimisticServerFunctionResult<
  TInput,
  TOutput,
  ServerFunctionError<TError>,
  TOptimisticState
> {
  const [optimisticState, addOptimistic] = useOptimistic(
    options.optimisticPassthrough,
    options.optimisticReducer,
  )

  const state = useServerFunction(fn, {
    ...options,
    interceptors: [
      onStart(({ input }) => {
        addOptimistic(input)
      }),
      ...toArray(options.interceptors),
    ],
  })

  return useMemo(() => ({ ...state, optimisticState }), [state, optimisticState]) as any
}
