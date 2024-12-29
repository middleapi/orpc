import type { ProcedureClient } from '@orpc/server'
import type { Hooks } from '@orpc/shared'
import { convertToStandardError } from '@orpc/server'
import { convertToArray, executeWithHooks } from '@orpc/shared'
import { useCallback, useMemo, useState } from 'react'

export type UseActionExecuteFn<TInput, TOutput> = (
  ...options:
    | [input: TInput, hooks?: Hooks<TInput, TOutput, undefined, undefined>]
    | (undefined extends TInput ? [] : never)
) => Promise<[TOutput, undefined, 'success'] | [undefined, Error, 'error']>

export type UseActionState<TInput, TOutput> = {
  execute: UseActionExecuteFn<TInput, TOutput>
  reset: () => void
} & (
  | { status: 'idle', isPending: false, isError: false, input: undefined, output: undefined, error: undefined }
  | { status: 'pending', isPending: true, isError: false, input: TInput, output: undefined, error: undefined }
  | { status: 'success', isPending: false, isError: false, input: TInput, output: TOutput, error: undefined }
  | { status: 'error', isPending: false, isError: true, input: TInput, output: undefined, error: Error }
)

const idleState = { status: 'idle', isPending: false, isError: false, input: undefined, output: undefined, error: undefined } as const

export function useAction<TInput, TOutput>(
  action: ProcedureClient<TInput, TOutput, any>,
  hooks?: Hooks<TInput, TOutput, undefined, undefined>,
): UseActionState<TInput, TOutput> {
  const [state, setState] = useState<Omit<UseActionState<TInput, TOutput>, 'execute' | 'reset'>>(idleState)

  const reset = useCallback(() => {
    setState(idleState)
  }, [])

  const execute = useCallback<UseActionExecuteFn<TInput, TOutput>>(async (...args) => {
    const input = args[0] as TInput
    const executeHooks = args[1]

    try {
      setState({
        status: 'pending',
        isPending: true,
        isError: false,
        input,
        output: undefined,
        error: undefined,
      })

      const output = await executeWithHooks({
        context: undefined,
        hooks: {
          interceptor: [...convertToArray(hooks?.interceptor), ...convertToArray(executeHooks?.interceptor)],
          onStart: [...convertToArray(hooks?.onStart), ...convertToArray(executeHooks?.onStart)],
          onSuccess: [...convertToArray(hooks?.onSuccess), ...convertToArray(executeHooks?.onSuccess)],
          onError: [...convertToArray(hooks?.onError), ...convertToArray(executeHooks?.onError)],
          onFinish: [...convertToArray(hooks?.onFinish), ...convertToArray(executeHooks?.onFinish)],
        },
        input,
        meta: undefined,
        execute: () => action(input),
      })

      setState({
        status: 'success',
        isPending: false,
        isError: false,
        input,
        output,
        error: undefined,
      })

      return [output, undefined, 'success']
    }
    catch (e) {
      const error = convertToStandardError(e)

      setState({
        status: 'error',
        isPending: false,
        isError: true,
        input,
        output: undefined,
        error,
      })

      return [undefined, error, 'error']
    }
  }, [action, hooks])

  const result = useMemo(() => ({
    ...state,
    execute,
    reset,
  }), [state, execute, reset])

  return result as any
}
