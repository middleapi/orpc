import type { ProcedureClient } from '@orpc/server'
import type { Hooks } from '@orpc/shared'
import type { SafeAction } from '../action-safe'
import { ORPCError } from '@orpc/server'
import { useCallback } from 'react'
import { useAction, type UseActionState } from './action-hooks'

export function useSafeAction<TInput, TOutput>(
  action: SafeAction<TInput, TOutput>,
  hooks?: Hooks<TInput, TOutput, undefined, undefined>,
): UseActionState<TInput, TOutput> {
  const normal: ProcedureClient<TInput, TOutput, unknown> = useCallback(async (...args) => {
    const [output, errorJson, status] = await action(...args)

    if (status === 'error') {
      throw ORPCError.fromJSON(errorJson)
    }

    return output
  }, [action])

  const state = useAction(normal, hooks)

  return state
}
