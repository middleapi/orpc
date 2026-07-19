import type { ClientContext } from '@orpc/client'
import type { DefineMutationOptionsTagged, DefineQueryOptions, DefineQueryOptionsTagged, EntryKey, UseMutationOptions, UseQueryOptions } from '@pinia/colada'
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
  = & (undefined extends TInput ? { input?: TInput } : { input: TInput })
    & (object extends TClientContext ? { context?: TClientContext } : { context: TClientContext })
    & Omit<DefineQueryOptions<TOutput, TError, TInitialData>, 'key' | 'query'>
    & Partial<Pick<DefineQueryOptions<TOutput, TError, TInitialData>, 'key' | 'query'>>

export type QueryOptions<TOutput, TError, TInitialData extends TOutput | undefined> = DefineQueryOptionsTagged<TOutput, TError, TInitialData>

export type MutationOptionsIn<TClientContext extends ClientContext, TInput, TOutput, TError, TMutationContext extends Record<any, any>>
  = & (object extends TClientContext ? { context?: TClientContext } : { context: TClientContext })
    & Omit<UseMutationOptions<TOutput, TInput, TError, TMutationContext>, 'mutation'>
    & Partial<Pick<UseMutationOptions<TOutput, TInput, TError, TMutationContext>, 'mutation'>>

export type MutationOptions<TInput, TOutput, TError, TMutationContext extends Record<any, any>> = DefineMutationOptionsTagged<TOutput, TInput, TError, TMutationContext>
