import type { ClientContext } from '@orpc/client'
import type { EntryKey, UseMutationOptions, UseQueryOptions } from '@pinia/colada'
import type { MaybeRefOrGetter } from 'vue'
import type { OperationType } from './key'

export type UseQueryFnContext = Parameters<UseQueryOptions<any>['query']>[0]

export type UseMutationFnContext = Parameters<UseMutationOptions<any, any>['mutation']>[1]

export const OPERATION_CONTEXT_SYMBOL: unique symbol = Symbol.for('ORPC_VUE_COLADA_OPERATION_CONTEXT') as any

export interface OperationContext {
  [OPERATION_CONTEXT_SYMBOL]?: {
    key: EntryKey
    type: OperationType
  }
}

export type QueryOptionsIn<TClientContext extends ClientContext, TInput, TOutput, TError, TInitialData extends TOutput | undefined>
  = & (undefined extends TInput ? { input?: MaybeRefOrGetter<TInput> } : { input: MaybeRefOrGetter<TInput> })
    & (object extends TClientContext ? { context?: MaybeRefOrGetter<TClientContext> } : { context: MaybeRefOrGetter<TClientContext> })
    & Omit<QueryOptions<TOutput, TError, TInitialData>, 'key' | 'query'>
    & Partial<Pick<QueryOptions<TOutput, TError, TInitialData>, 'key' | 'query'>>

export type QueryOptions<TOutput, TError, TInitialData extends TOutput | undefined> = UseQueryOptions<TOutput, TError, TInitialData>

export type MutationOptionsIn<TClientContext extends ClientContext, TInput, TOutput, TError, TMutationContext extends Record<any, any>>
  = & (object extends TClientContext ? { context?: MaybeRefOrGetter<TClientContext> } : { context: MaybeRefOrGetter<TClientContext> })
    & Omit<MutationOptions<TInput, TOutput, TError, TMutationContext>, 'mutation'>
    & Partial<Pick<MutationOptions<TInput, TOutput, TError, TMutationContext>, 'mutation'>>

export type MutationOptions<TInput, TOutput, TError, TMutationContext extends Record<any, any>> = UseMutationOptions<TOutput, TInput, TError, TMutationContext>
