import type { ClientContext } from '@orpc/client'
import type { PartialDeep } from '@orpc/shared'
import type { DataTag, InfiniteData, InfiniteQueryObserverOptions, MutationObserverOptions, QueryFunction, QueryKey, QueryObserverOptions, SkipToken } from '@tanstack/query-core'
import type { SerializableStreamedQueryOptions } from './stream-query'

export type InferStreamedQueryOutput<TOutput> = TOutput extends AsyncIterable<infer U> ? U[] : never
export type InferLiveQueryOutput<TOutput> = TOutput extends AsyncIterable<infer U> ? U : never

export type OperationType = 'query' | 'streamed' | 'live' | 'infinite' | 'mutation'

export type OperationKeyOptions<TType extends OperationType, TInput> = {
  type?: TType
  input?: TType extends 'mutation' ? never : PartialDeep<TInput>
  fnOptions?: TType extends 'streamed' ? SerializableStreamedQueryOptions : never
}

export type OperationKey<TType extends OperationType, TInput> = [path: string[], options: OperationKeyOptions<TType, TInput>]

export const OPERATION_CONTEXT_SYMBOL: unique symbol = Symbol.for('ORPC_TANSTACK_QUERY_OPERATION_CONTEXT') as any

export interface OperationContext {
  [OPERATION_CONTEXT_SYMBOL]?: {
    key: QueryKey
    type: OperationType
  }
}

export type QueryKeyOptions<TInput>
  = | (undefined extends TInput ? { input?: TInput | SkipToken } : { input: TInput | SkipToken })
    | { queryKey: QueryKey }

export type QueryOptionsIn<TClientContext extends ClientContext, TInput, TOutput, TError, TSelectData, TInitialData>
  = & (undefined extends TInput ? { input?: TInput | SkipToken } : { input: TInput | SkipToken })
    & (object extends TClientContext ? { context?: TClientContext } : { context: TClientContext })
    & Omit<QueryObserverOptions<TOutput, TError, TSelectData>, 'queryKey' | '_defaulted' | '_optimisticResults'>
    & { queryKey?: QueryKey, initialData?: TInitialData }

export type QueryOptionsOut<TOutput, TError, TSelectData, TInitialData>
  = & Pick<
    QueryObserverOptions<TOutput, TError, TSelectData, TOutput, DataTag<QueryKey, TOutput, TError>>,
    'queryKey' | 'throwOnError' | 'select' | 'retryDelay'
  >
  & (undefined extends TInitialData ? object : { initialData: TInitialData })
  & {
    queryFn: QueryFunction<TOutput, DataTag<QueryKey, TOutput, TError>>
  }

export type StreamedKeyOptions<TInput>
  = | ((undefined extends TInput ? { input?: TInput | SkipToken } : { input: TInput | SkipToken }) & { queryFnOptions?: SerializableStreamedQueryOptions })
    | { queryKey: QueryKey }

export type StreamedOptionsIn<TClientContext extends ClientContext, TInput, TOutput, TError, TSelectData, TInitialData>
  = & QueryOptionsIn<TClientContext, TInput, TOutput, TError, TSelectData, TInitialData>
    & { queryFnOptions?: SerializableStreamedQueryOptions }

export type StreamedOptionsOut<TOutput, TError, TSelectData, TInitialData> = QueryOptionsOut<TOutput, TError, TSelectData, TInitialData>

export type InfiniteKeyOptions<TInput, TPageParam>
  = | Pick<InfiniteOptionsIn<any, TInput, any, any, any, TPageParam, any>, 'input' | 'initialPageParam'>
    | { queryKey: QueryKey }

export type InfiniteOptionsIn<TClientContext extends ClientContext, TInput, TOutput, TError, TSelectData, TPageParam, TInitialData>
  = & { input: ((pageParam: TPageParam) => TInput) | SkipToken, initialData?: TInitialData, queryKey?: QueryKey }
    & (object extends TClientContext ? { context?: TClientContext } : { context: TClientContext })
    & Omit<InfiniteQueryObserverOptions<TOutput, TError, TSelectData, QueryKey, TPageParam>, 'queryKey' | '_defaulted' | '_optimisticResults'>

export type InfiniteOptionsOut<TOutput, TError, TSelectData, TPageParam, TInitialData>
  = & Pick<
    InfiniteQueryObserverOptions<TOutput, TError, TSelectData, DataTag<QueryKey, InfiniteData<TOutput, TPageParam>, TError>, TPageParam>,
    'queryKey' | 'select' | 'throwOnError' | 'retryDelay' | 'initialPageParam' | 'getNextPageParam' | 'getPreviousPageParam'
  >
  & (undefined extends TInitialData ? object : { initialData: TInitialData })
  & {
    queryFn: QueryFunction<TOutput, DataTag<QueryKey, InfiniteData<TOutput, TPageParam>, TError>, TPageParam>
  }

export type MutationKeyOptions = Pick<MutationOptionsIn<any, any, any, any, any>, 'mutationKey'>

export type MutationOptionsIn<TClientContext extends ClientContext, TInput, TOutput, TError, TMutationContext>
  = & (object extends TClientContext ? { context?: TClientContext } : { context: TClientContext })
    & MutationOptionsOut<TInput, TOutput, TError, TMutationContext>

export type MutationOptionsOut<TInput, TOutput, TError, TMutationContext> = MutationObserverOptions<TOutput, TError, TInput, TMutationContext>
