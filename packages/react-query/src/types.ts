import type { ClientContext } from '@orpc/client'
import type { SetOptional } from '@orpc/shared'
import type { experimental_streamedQuery, QueryFunctionContext, QueryKey, SkipToken, UseInfiniteQueryOptions, UseMutationOptions, UseQueryOptions } from '@tanstack/react-query'

export type QueryOptionsIn<TClientContext extends ClientContext, TInput, TOutput, TError, TSelectData>
  = & (undefined extends TInput ? { input?: TInput | SkipToken } : { input: TInput | SkipToken })
    & (Record<never, never> extends TClientContext ? { context?: TClientContext } : { context: TClientContext })
    & SetOptional<UseQueryOptions<TOutput, TError, TSelectData>, 'queryKey'>

export interface QueryOptionsBase<TOutput, TError> {
  queryKey: QueryKey
  queryFn(ctx: QueryFunctionContext): Promise<TOutput>
  throwOnError?(error: TError): boolean // Help TQ infer TError
  retryDelay?: (count: number, error: TError) => number // Help TQ infer TError (suspense hooks)
  enabled: boolean
}

type experimental_StreamedQueryOptions = Omit<Parameters<typeof experimental_streamedQuery>[0], 'queryFn'>

export type experimental_InferStreamedOutput<TOutput> = TOutput extends AsyncIterable<infer U> ? U[] : never

export type experimental_StreamedOptionsIn<TClientContext extends ClientContext, TInput, TOutput, TError, TSelectData>
  = & QueryOptionsIn<TClientContext, TInput, TOutput, TError, TSelectData>
    & { queryFnOptions?: experimental_StreamedQueryOptions }

export interface experimental_StreamedOptionsBase<TOutput, TError> extends QueryOptionsBase<TOutput, TError> {
}

export type InfiniteOptionsIn<TClientContext extends ClientContext, TInput, TOutput, TError, TSelectData, TPageParam>
  = & { input: ((pageParam: TPageParam) => TInput) | SkipToken }
    & (Record<never, never> extends TClientContext ? { context?: TClientContext } : { context: TClientContext })
    & SetOptional<UseInfiniteQueryOptions<TOutput, TError, TSelectData, QueryKey, TPageParam>, 'queryKey'>

export interface InfiniteOptionsBase<TOutput, TError, TPageParam> {
  queryKey: QueryKey
  queryFn(ctx: QueryFunctionContext<QueryKey, TPageParam>): Promise<TOutput>
  throwOnError?(error: TError): boolean // Help TQ infer TError
  retryDelay?: (count: number, error: TError) => number // Help TQ infer TError (suspense hooks)
  enabled: boolean
}

export type MutationOptionsIn<TClientContext extends ClientContext, TInput, TOutput, TError, TMutationContext>
  = & (Record<never, never> extends TClientContext ? { context?: TClientContext } : { context: TClientContext })
    & MutationOptions<TInput, TOutput, TError, TMutationContext>

export type MutationOptions<TInput, TOutput, TError, TMutationContext> = UseMutationOptions<TOutput, TError, TInput, TMutationContext>
