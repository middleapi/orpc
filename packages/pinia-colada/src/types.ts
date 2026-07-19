import type { ClientContext } from '@orpc/client'
import type { DefineInfiniteQueryOptions, DefineInfiniteQueryOptionsTagged, DefineMutationOptionsTagged, DefineQueryOptions, DefineQueryOptionsTagged, EntryKey, UseInfiniteQueryData, UseMutationOptions, UseQueryOptions } from '@pinia/colada'
import type { SerializableStreamedQueryOptions } from './stream-query'

export type InferStreamedQueryOutput<TOutput> = TOutput extends AsyncIterable<infer U> ? U[] : never
export type InferLiveQueryOutput<TOutput> = TOutput extends AsyncIterable<infer U> ? U : never

export type UseQueryFnContext = Parameters<UseQueryOptions<any>['query']>[0]

export type UseMutationFnContext = Parameters<UseMutationOptions<any, any>['mutation']>[1]

export const OPERATION_CONTEXT_SYMBOL: unique symbol = Symbol.for('ORPC_PINIA_COLADA_OPERATION_CONTEXT') as any

export type OperationType = 'query' | 'streamed' | 'live' | 'infinite' | 'mutation'

export interface OperationContext {
  [OPERATION_CONTEXT_SYMBOL]?: {
    key: EntryKey
    type: OperationType
  }
}

export type QueryKeyOptions<TInput>
  = | (undefined extends TInput ? { input?: TInput } : { input: TInput })
    | { key: EntryKey }

export type QueryOptionsIn<TClientContext extends ClientContext, TInput, TOutput, TError, TInitialData extends TOutput | undefined>
  = & (undefined extends TInput ? { input?: TInput } : { input: TInput })
    & (object extends TClientContext ? { context?: TClientContext } : { context: TClientContext })
    & Omit<DefineQueryOptions<TOutput, TError, TInitialData>, 'key' | 'query'>
    & Partial<Pick<DefineQueryOptions<TOutput, TError, TInitialData>, 'key' | 'query'>>

export type QueryOptionsOut<TOutput, TError, TInitialData extends TOutput | undefined> = DefineQueryOptionsTagged<TOutput, TError, TInitialData>

export type StreamedKeyOptions<TInput>
  = | ((undefined extends TInput ? { input?: TInput } : { input: TInput }) & { fnOptions?: SerializableStreamedQueryOptions })
    | { key: EntryKey }

export type StreamedOptionsIn<TClientContext extends ClientContext, TInput, TOutput, TError, TInitialData extends TOutput | undefined>
  = & QueryOptionsIn<TClientContext, TInput, TOutput, TError, TInitialData>
    & { fnOptions?: SerializableStreamedQueryOptions }

export type StreamedOptionsOut<TOutput, TError, TInitialData extends TOutput | undefined> = QueryOptionsOut<TOutput, TError, TInitialData>

export type InfiniteKeyOptions<TInput, TPageParam>
  = | Pick<InfiniteOptionsIn<any, TInput, any, any, TPageParam, any>, 'input' | 'initialPageParam'>
    | { key: EntryKey }

export type InfiniteOptionsIn<TClientContext extends ClientContext, TInput, TOutput, TError, TPageParam, TInitialData extends UseInfiniteQueryData<TOutput, TPageParam> | undefined>
  = & { input: (pageParam: TPageParam) => TInput }
    & (object extends TClientContext ? { context?: TClientContext } : { context: TClientContext })
    & Omit<DefineInfiniteQueryOptions<TOutput, TError, TPageParam, TInitialData>, 'key' | 'query'>
    & Partial<Pick<DefineInfiniteQueryOptions<TOutput, TError, TPageParam, TInitialData>, 'key' | 'query'>>

export type InfiniteOptionsOut<TOutput, TError, TPageParam, TInitialData extends UseInfiniteQueryData<TOutput, TPageParam> | undefined> = DefineInfiniteQueryOptionsTagged<TOutput, TError, TPageParam, TInitialData>

export type MutationKeyOptions<TInput> = Pick<MutationOptionsIn<any, TInput, any, any, any>, 'key'>

export type MutationOptionsIn<TClientContext extends ClientContext, TInput, TOutput, TError, TMutationContext extends Record<any, any>>
  = & (object extends TClientContext ? { context?: TClientContext } : { context: TClientContext })
    & Omit<UseMutationOptions<TOutput, TInput, TError, TMutationContext>, 'mutation'>
    & Partial<Pick<UseMutationOptions<TOutput, TInput, TError, TMutationContext>, 'mutation'>>

export type MutationOptionsOut<TInput, TOutput, TError, TMutationContext extends Record<any, any>> = DefineMutationOptionsTagged<TOutput, TInput, TError, TMutationContext>
