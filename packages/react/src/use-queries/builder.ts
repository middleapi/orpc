import type { ProcedureClient } from '@orpc/server'
import type { SetOptional } from '@orpc/shared'
import type {
  DefaultError,
  OmitKeyof,
  QueriesPlaceholderDataFunction,
  QueryKey,
  UseQueryOptions,
} from '@tanstack/react-query'
import { getQueryKeyFromPath } from '../tanstack-key'

type UseQueryOptionsForUseQueries<
  TQueryFnData,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
> = OmitKeyof<
  UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
  'placeholderData'
> & {
  placeholderData?: TQueryFnData | QueriesPlaceholderDataFunction<TQueryFnData>
}

export interface UseQueriesBuilder<TInput, TOutput> {
  (
    input: TInput,
    options?: SetOptional<
      UseQueryOptionsForUseQueries<TOutput>,
      'queryFn' | 'queryKey'
    >,
  ): UseQueryOptionsForUseQueries<TOutput>
}

export interface CreateUseQueriesBuilderOptions<TInput, TOutput> {
  client: ProcedureClient<TInput, TOutput, any>

  /**
   * The path of procedure on server
   */
  path: string[]
}

export function createUseQueriesBuilder<TInput, TOutput>(
  options: CreateUseQueriesBuilderOptions<TInput, TOutput>,
): UseQueriesBuilder<TInput, TOutput> {
  return (input, options_) => {
    return {
      queryKey: getQueryKeyFromPath(options.path, { input, type: 'query' }),
      queryFn: ({ signal }) => options.client(input, { signal }),
      ...options_,
    }
  }
}
