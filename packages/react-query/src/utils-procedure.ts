import type { ProcedureClient } from '@orpc/server'
import type { IsEqual } from '@orpc/shared'
import type { QueryKey } from '@tanstack/react-query'
import type { InfiniteOptions, MutationOptions, QueryOptions } from './types'
import { buildKey } from './key'

/**
 * Utils at procedure level
 */
export interface ProcedureUtils<TInput, TOutput, TClientContext> {
  queryOptions: <U extends QueryOptions<TInput, TOutput, TClientContext, any>>(
    ...opts: [options: U] | (undefined extends TInput & TClientContext ? [] : never)
  ) => IsEqual<U, QueryOptions<TInput, TOutput, TClientContext, any>> extends true
    ? { queryKey: QueryKey, queryFn: () => Promise<TOutput> }
    : Omit<{ queryKey: QueryKey, queryFn: () => Promise<TOutput> }, keyof U> & U

  infiniteOptions: <U extends InfiniteOptions<TInput, TOutput, TClientContext, any>>(
    options: U
  ) => Omit<{ queryKey: QueryKey, queryFn: () => Promise<TOutput>, initialPageParam: undefined }, keyof U> & U

  mutationOptions: <U extends MutationOptions<TInput, TOutput, TClientContext>>(
    ...opt: [options: U] | (undefined extends TClientContext ? [] : never)
  ) => IsEqual<U, MutationOptions<TInput, TOutput, TClientContext>> extends true
    ? { mutationKey: QueryKey, mutationFn: (input: TInput) => Promise<TOutput> }
    : Omit<{ mutationKey: QueryKey, mutationFn: (input: TInput) => Promise<TOutput> }, keyof U> & U
}

export function createProcedureUtils<TInput, TOutput, TClientContext>(
  client: ProcedureClient<TInput, TOutput, TClientContext>,
  path: string[],
): ProcedureUtils<TInput, TOutput, TClientContext> {
  return {
    queryOptions(...[options]) {
      const input = options?.input as any

      return {
        queryKey: buildKey(path, { type: 'query', input }),
        queryFn: ({ signal }) => client(input, { signal, context: options?.context } as any),
        ...(options as any),
      }
    },

    infiniteOptions(options) {
      const input = options.input as any

      return {
        queryKey: buildKey(path, { type: 'infinite', input }),
        queryFn: ({ pageParam, signal }) => client({ ...input, cursor: pageParam }, { signal, context: options.context } as any),
        ...(options as any),
      }
    },

    mutationOptions(...[options]) {
      return {
        mutationKey: buildKey(path, { type: 'mutation' }),
        mutationFn: input => client(input, { context: options?.context } as any),
        ...(options as any),
      }
    },
  }
}
