import type { ClientContext } from '@orpc/client'
import type {
  DataTag,
  InfiniteData,
  InfiniteQueryObserverOptions,
  MutationObserverOptions,
  QueryFunction,
  QueryKey,
  QueryObserverOptions,
  SkipToken,
} from '@tanstack/query-core'

import type { SerializableStreamedQueryOptions, SettleOnFirstDataOptions } from './stream-query'

export type InferStreamedQueryOutput<TOutput> = TOutput extends AsyncIterable<infer U> ? U[] : never
export type InferLiveQueryOutput<TOutput> = TOutput extends AsyncIterable<infer U> ? U : never

export type OperationType = 'query' | 'streamed' | 'live' | 'infinite' | 'mutation'

/**
 * The symbol under which TanStack Query utils attach operation details
 * (key and operation type) to the client context.
 *
 * @see {@link https://orpc.dev/docs/integrations/tanstack-query#client-context | TanStack Query Integration - Client Context}
 */
export const TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL: unique symbol = /* @__PURE__ */ Symbol.for(
  'ORPC_TANSTACK_QUERY_OPERATION_CONTEXT',
) as any

/**
 * A client context automatically populated by TanStack Query utils,
 * exposing the operation key and type of the calling operation.
 *
 * @see {@link https://orpc.dev/docs/integrations/tanstack-query#client-context | TanStack Query Integration - Client Context}
 */
export interface TanstackQueryOperationContext {
  [TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL]?: {
    key: QueryKey
    type: OperationType
  }
}

export type QueryKeyOptions<TInput> =
  | (undefined extends TInput ? { input?: TInput | SkipToken } : { input: TInput | SkipToken })
  | { queryKey: QueryKey }

export type QueryOptionsIn<
  TClientContext extends ClientContext,
  TInput,
  TOutput,
  TError,
  TSelectData,
  TInitialData,
> = (undefined extends TInput ? { input?: TInput | SkipToken } : { input: TInput | SkipToken }) &
  ({} extends TClientContext
    ? { context?: TClientContext | undefined }
    : { context: TClientContext }) &
  Omit<
    QueryObserverOptions<TOutput, TError, TSelectData>,
    'queryKey' | '_defaulted' | '_optimisticResults'
  > & { queryKey?: QueryKey | undefined; initialData?: TInitialData }

/**
 * Rest parameters of `.queryOptions`: optional when input and context are.
 * Cheaper than `MaybeOptionalOptions<QueryOptionsIn<...>>`.
 */
export type QueryOptionsInRest<
  TClientContext extends ClientContext,
  TInput,
  TOutput,
  TError,
  TSelectData,
  TInitialData,
> = undefined extends TInput
  ? {} extends TClientContext
    ? [options?: QueryOptionsIn<TClientContext, TInput, TOutput, TError, TSelectData, TInitialData>]
    : [options: QueryOptionsIn<TClientContext, TInput, TOutput, TError, TSelectData, TInitialData>]
  : [options: QueryOptionsIn<TClientContext, TInput, TOutput, TError, TSelectData, TInitialData>]

export type QueryOptionsOut<TOutput, TError, TSelectData, TInitialData> = Pick<
  QueryObserverOptions<TOutput, TError, TSelectData, TOutput, DataTag<QueryKey, TOutput, TError>>,
  'queryKey' | 'throwOnError' | 'select' | 'retryDelay'
> &
  (undefined extends TInitialData ? object : { initialData: TInitialData }) & {
    queryFn: QueryFunction<TOutput, DataTag<QueryKey, TOutput, TError>>
  }

export type StreamedKeyOptions<TInput> =
  | ((undefined extends TInput ? { input?: TInput | SkipToken } : { input: TInput | SkipToken }) & {
      fnOptions?: SerializableStreamedQueryOptions | undefined
    })
  | { queryKey: QueryKey }

export type StreamedOptionsIn<
  TClientContext extends ClientContext,
  TInput,
  TOutput,
  TError,
  TSelectData,
  TInitialData,
> = QueryOptionsIn<TClientContext, TInput, TOutput, TError, TSelectData, TInitialData> & {
  fnOptions?: SerializableStreamedQueryOptions | undefined
} & SettleOnFirstDataOptions

/**
 * Rest parameters of `.streamedOptions`: optional when input and context are.
 * Cheaper than `MaybeOptionalOptions<StreamedOptionsIn<...>>`.
 */
export type StreamedOptionsInRest<
  TClientContext extends ClientContext,
  TInput,
  TOutput,
  TError,
  TSelectData,
  TInitialData,
> = undefined extends TInput
  ? {} extends TClientContext
    ? [
        options?: StreamedOptionsIn<
          TClientContext,
          TInput,
          TOutput,
          TError,
          TSelectData,
          TInitialData
        >,
      ]
    : [
        options: StreamedOptionsIn<
          TClientContext,
          TInput,
          TOutput,
          TError,
          TSelectData,
          TInitialData
        >,
      ]
  : [options: StreamedOptionsIn<TClientContext, TInput, TOutput, TError, TSelectData, TInitialData>]

export type StreamedOptionsOut<TOutput, TError, TSelectData, TInitialData> = QueryOptionsOut<
  TOutput,
  TError,
  TSelectData,
  TInitialData
>

export type LiveOptionsIn<
  TClientContext extends ClientContext,
  TInput,
  TOutput,
  TError,
  TSelectData,
  TInitialData,
> = QueryOptionsIn<TClientContext, TInput, TOutput, TError, TSelectData, TInitialData> &
  SettleOnFirstDataOptions

/**
 * Rest parameters of `.liveOptions`: optional when input and context are.
 * Cheaper than `MaybeOptionalOptions<LiveOptionsIn<...>>`.
 */
export type LiveOptionsInRest<
  TClientContext extends ClientContext,
  TInput,
  TOutput,
  TError,
  TSelectData,
  TInitialData,
> = undefined extends TInput
  ? {} extends TClientContext
    ? [options?: LiveOptionsIn<TClientContext, TInput, TOutput, TError, TSelectData, TInitialData>]
    : [options: LiveOptionsIn<TClientContext, TInput, TOutput, TError, TSelectData, TInitialData>]
  : [options: LiveOptionsIn<TClientContext, TInput, TOutput, TError, TSelectData, TInitialData>]

export type InfiniteKeyOptions<TInput, TPageParam> =
  | Pick<
      InfiniteOptionsIn<any, TInput, any, any, any, TPageParam, any>,
      'input' | 'initialPageParam'
    >
  | { queryKey: QueryKey }

export type InfiniteOptionsIn<
  TClientContext extends ClientContext,
  TInput,
  TOutput,
  TError,
  TSelectData,
  TPageParam,
  TInitialData,
> = {
  input: ((pageParam: TPageParam) => TInput) | SkipToken
  initialData?: TInitialData
  queryKey?: QueryKey | undefined
} & ({} extends TClientContext
  ? { context?: TClientContext | undefined }
  : { context: TClientContext }) &
  Omit<
    InfiniteQueryObserverOptions<TOutput, TError, TSelectData, QueryKey, TPageParam>,
    'queryKey' | '_defaulted' | '_optimisticResults'
  >

export type InfiniteOptionsOut<TOutput, TError, TSelectData, TPageParam, TInitialData> = Pick<
  InfiniteQueryObserverOptions<
    TOutput,
    TError,
    TSelectData,
    DataTag<QueryKey, InfiniteData<TOutput, TPageParam>, TError>,
    TPageParam
  >,
  | 'queryKey'
  | 'select'
  | 'throwOnError'
  | 'retryDelay'
  | 'initialPageParam'
  | 'getNextPageParam'
  | 'getPreviousPageParam'
> &
  (undefined extends TInitialData ? object : { initialData: TInitialData }) & {
    queryFn: QueryFunction<
      TOutput,
      DataTag<QueryKey, InfiniteData<TOutput, TPageParam>, TError>,
      TPageParam
    >
  }

export type MutationKeyOptions = Pick<MutationOptionsIn<any, any, any, any, any>, 'mutationKey'>

export type MutationOptionsIn<
  TClientContext extends ClientContext,
  TInput,
  TOutput,
  TError,
  TMutationContext,
> = ({} extends TClientContext
  ? { context?: TClientContext | undefined }
  : { context: TClientContext }) &
  MutationOptionsOut<TInput, TOutput, TError, TMutationContext>

/**
 * Rest parameters of `.mutationOptions`: optional when context is.
 * Cheaper than `MaybeOptionalOptions<MutationOptionsIn<...>>`.
 */
export type MutationOptionsInRest<
  TClientContext extends ClientContext,
  TInput,
  TOutput,
  TError,
  TMutationContext,
> = {} extends TClientContext
  ? [options?: MutationOptionsIn<TClientContext, TInput, TOutput, TError, TMutationContext>]
  : [options: MutationOptionsIn<TClientContext, TInput, TOutput, TError, TMutationContext>]

export type MutationOptionsOut<TInput, TOutput, TError, TMutationContext> = MutationObserverOptions<
  TOutput,
  TError,
  TInput,
  TMutationContext
>
