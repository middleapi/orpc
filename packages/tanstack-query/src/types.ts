import type { ClientContext } from '@orpc/client'
import type { PartialDeep, SetOptional } from '@orpc/shared'
import type {
  DataTag,
  experimental_streamedQuery,
  InfiniteData,
  InfiniteQueryObserverOptions,
  MutationObserverOptions,
  QueryFunction,
  QueryKey,
  QueryObserverOptions,
  SkipToken,
} from '@tanstack/query-core'

export type experimental_StreamedQueryOutput<TOutput> = TOutput extends AsyncIterable<infer U> ? U[] : never
export type experimental_LiveQueryOutput<TOutput> = TOutput extends AsyncIterable<infer U> ? U : never

type experimental_StreamedQueryOptions = Omit<Parameters<typeof experimental_streamedQuery>[0], 'queryFn'>

export type OperationType = 'query' | 'streamed' | 'live' | 'infinite' | 'mutation'

export type OperationKeyOptions<TType extends OperationType, TInput> = {
  type?: TType
  input?: TType extends 'mutation' ? never : PartialDeep<TInput>
  fnOptions?: TType extends 'streamed' ? experimental_StreamedQueryOptions : never
}

export type OperationKey<TType extends OperationType, TInput> = [path: readonly string[], options: OperationKeyOptions<TType, TInput>]

export const OPERATION_CONTEXT_SYMBOL: unique symbol = Symbol('ORPC_OPERATION_CONTEXT')

export interface OperationContext {
  [OPERATION_CONTEXT_SYMBOL]?: {
    key: QueryKey
    type: OperationType
  }
}

export type QueryKeyOptions<TInput>
  = & (undefined extends TInput ? { input?: TInput | SkipToken } : { input: TInput | SkipToken })
    & { queryKey?: QueryKey }

export type QueryOptionsIn<TClientContext extends ClientContext, TInput, TOutput, TError, TSelectData>
  = & QueryKeyOptions<TInput>
    & (Record<never, never> extends TClientContext ? { context?: TClientContext } : { context: TClientContext })
    & Omit<QueryObserverOptions<TOutput, TError, TSelectData>, 'queryKey'>

export interface QueryOptionsBase<TOutput, TError> {
  queryKey: DataTag<QueryKey, TOutput, TError>
  queryFn: QueryFunction<TOutput>
  throwOnError?: (error: TError) => boolean // Help TQ infer TError
  retryDelay?: (count: number, error: TError) => number // Help TQ infer TError (suspense hooks)
  enabled?: boolean
}

export type experimental_StreamedKeyOptions<TInput>
  = & QueryKeyOptions<TInput>
    & { queryFnOptions?: experimental_StreamedQueryOptions }

export type experimental_StreamedOptionsIn<TClientContext extends ClientContext, TInput, TOutput, TError, TSelectData>
  = & QueryOptionsIn<TClientContext, TInput, TOutput, TError, TSelectData>
    & { queryFnOptions?: experimental_StreamedQueryOptions }

export interface experimental_StreamedOptionsBase<TOutput, TError> extends QueryOptionsBase<TOutput, TError> {
}

export type InfiniteOptionsIn<TClientContext extends ClientContext, TInput, TOutput, TError, TSelectData, TPageParam>
  = & { input: ((pageParam: TPageParam) => TInput) | SkipToken }
    & (Record<never, never> extends TClientContext ? { context?: TClientContext } : { context: TClientContext })
    & SetOptional<InfiniteQueryObserverOptions<TOutput, TError, TSelectData, QueryKey, TPageParam>, 'queryKey'>

export interface InfiniteOptionsBase<TOutput, TError, TPageParam> {
  queryKey: DataTag<QueryKey, InfiniteData<TOutput, TPageParam>, TError>
  queryFn: QueryFunction<TOutput, QueryKey, TPageParam>
  select?(): InfiniteData<TOutput, TPageParam> // Help TQ infer TPageParam
  throwOnError?: (error: TError) => boolean // Help TQ infer TError
  retryDelay?: (count: number, error: TError) => number // Help TQ infer TError (suspense hooks)
  enabled?: boolean
}

export type MutationOptionsIn<TClientContext extends ClientContext, TInput, TOutput, TError, TMutationContext>
  = & (Record<never, never> extends TClientContext ? { context?: TClientContext } : { context: TClientContext })
    & MutationOptions<TInput, TOutput, TError, TMutationContext>

export type MutationOptions<TInput, TOutput, TError, TMutationContext> = MutationObserverOptions<TOutput, TError, TInput, TMutationContext>
