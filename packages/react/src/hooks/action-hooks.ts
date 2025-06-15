import type { ORPCErrorJSON, SafeResult } from '@orpc/client'
import type { ActionableClient, UnactionableError } from '@orpc/server'
import type { Interceptor, PromiseWithError } from '@orpc/shared'
import { createORPCErrorFromJson, safe } from '@orpc/client'
import { intercept, toArray } from '@orpc/shared'
import { useCallback, useMemo, useRef, useState, useTransition } from 'react'

export interface UseServerActionOptions<TInput, TOutput, TError> {
  interceptors?: Interceptor<{ input: TInput }, PromiseWithError<TOutput, TError>>[]
}

export interface UseServerActionExecuteOptions<TInput, TOutput, TError> extends Pick<UseServerActionOptions<TInput, TOutput, TError>, 'interceptors'> {
}

export type UseServerActionExecuteRest<TInput, TOutput, TError>
  = undefined extends TInput
    ? [input?: TInput, options?: UseServerActionExecuteOptions<TInput, TOutput, TError>]
    : [input: TInput, options?: UseServerActionExecuteOptions<TInput, TOutput, TError>]

export interface UseServerActionResultBase<TInput, TOutput, TError> {
  reset: () => void
  execute: (...rest: UseServerActionExecuteRest<TInput, TOutput, TError>) => Promise<SafeResult<TOutput, TError>>
}

export interface UseServerActionIdleResult<TInput, TOutput, TError> extends UseServerActionResultBase<TInput, TOutput, TError> {
  input: undefined
  data: undefined
  error: null
  isIdle: true
  isPending: false
  isSuccess: false
  isError: false
  status: 'idle'
  executedAt: undefined
}

export interface UseServerActionPendingResult<TInput, TOutput, TError> extends UseServerActionResultBase<TInput, TOutput, TError> {
  input: TInput
  data: undefined
  error: null
  isIdle: false
  isPending: true
  isSuccess: false
  isError: false
  status: 'pending'
  executedAt: Date
}

export interface UseServerActionSuccessResult<TInput, TOutput, TError> extends UseServerActionResultBase<TInput, TOutput, TError> {
  input: TInput
  data: TOutput
  error: null
  isIdle: false
  isPending: false
  isSuccess: true
  isError: false
  status: 'success'
  executedAt: Date
}

export interface UseServerActionErrorResult<TInput, TOutput, TError> extends UseServerActionResultBase<TInput, TOutput, TError> {
  input: TInput
  data: undefined
  error: TError
  isIdle: false
  isPending: false
  isSuccess: false
  isError: true
  status: 'error'
  executedAt: Date
}

const INITIAL_STATE = {
  data: undefined,
  error: null,
  isIdle: true,
  isPending: false,
  isSuccess: false,
  isError: false,
  status: 'idle',
} as const

const PENDING_STATE = {
  data: undefined,
  error: null,
  isIdle: false,
  isPending: true,
  isSuccess: false,
  isError: false,
  status: 'pending',
}

/**
 * Use a Server Action Hook
 *
 * @see {@link https://orpc.unnoq.com/docs/server-action#useserveraction-hook Server Action Hook Docs}
 */
export function useServerAction<TInput, TOutput, TError extends ORPCErrorJSON<any, any>>(
  action: ActionableClient<TInput, TOutput, TError>,
  options: NoInfer<UseServerActionOptions<TInput, TOutput, UnactionableError<TError>>> = {},
): UseServerActionIdleResult<TInput, TOutput, UnactionableError<TError>>
  | UseServerActionSuccessResult<TInput, TOutput, UnactionableError<TError>>
  | UseServerActionErrorResult<TInput, TOutput, UnactionableError<TError>>
  | UseServerActionPendingResult<TInput, TOutput, UnactionableError<TError>> {
  const [state, setState] = useState<Omit<
    | UseServerActionIdleResult<TInput, TOutput, UnactionableError<TError>>
    | UseServerActionSuccessResult<TInput, TOutput, UnactionableError<TError>>
    | UseServerActionErrorResult<TInput, TOutput, UnactionableError<TError>>,
    keyof UseServerActionResultBase<TInput, TOutput, UnactionableError<TError>> | 'executedAt' | 'input'
  >>(INITIAL_STATE)

  const executedAtRef = useRef<Date | undefined>(undefined)
  const [input, setInput] = useState<TInput | undefined>(undefined)
  const [isPending, startTransition] = useTransition()

  const reset = useCallback(() => {
    executedAtRef.current = undefined
    setInput(undefined)
    setState({ ...INITIAL_STATE })
  }, [])

  const execute = useCallback(async (input: TInput, executeOptions: UseServerActionExecuteOptions<TInput, TOutput, UnactionableError<TError>> = {}) => {
    const executedAt = new Date()
    executedAtRef.current = executedAt

    setInput(input)

    return new Promise((resolve) => {
      startTransition(async () => {
        const result = await safe(intercept(
          [...toArray(options.interceptors), ...toArray(executeOptions.interceptors)],
          { input: input as TInput },
          async ({ input }) => action(input).then(([error, data]) => {
            if (error) {
              throw createORPCErrorFromJson(error)
            }

            return data as TOutput
          }),
        ))

        /**
         * If multiple execute calls are made in parallel, only the last one will be effective.
         */
        if (executedAtRef.current === executedAt) {
          setState({
            data: result.data,
            error: result.error as any,
            isIdle: false,
            isPending: false,
            isSuccess: !result.error,
            isError: !!result.error,
            status: !result.error ? 'success' : 'error',
          })
        }

        resolve(result)
      })
    })
  }, [action, ...toArray(options.interceptors)])

  const result = useMemo(() => {
    const currentState = isPending && executedAtRef.current !== undefined
      ? PENDING_STATE
      : state

    return {
      ...currentState,
      executedAt: executedAtRef.current,
      input,
      reset,
      execute,
    }
  }, [isPending, state, input, reset, execute])

  return result as any
}
