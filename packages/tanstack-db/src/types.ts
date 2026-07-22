import type { ClientContext } from '@orpc/client'
import type { AnySchema, InferSchemaInput, InferSchemaOutput } from '@orpc/contract'
import type { Collection, CollectionConfig, LoadSubsetOptions, OperationType, PendingMutation, TransactionWithMutations } from '@tanstack/db'
import type { QueryFunctionContext, QueryKey } from '@tanstack/query-core'
import type { QueryCollectionConfig, QueryCollectionUtils } from '@tanstack/query-db-collection'

export type InferCollectionSchemaOutput<T extends AnySchema>
  = InferSchemaOutput<T> extends object
    ? InferSchemaOutput<T>
    : Record<string, unknown>

export type InferCollectionSchemaInput<T extends AnySchema>
  = InferSchemaInput<T> extends object
    ? InferSchemaInput<T>
    : Record<string, unknown>

export type InferCollectionItem<TOutput> = TOutput extends Array<infer U extends object> ? U : never

export type CollectionQueryFn<TOutput> = (context: QueryFunctionContext) => Promise<TOutput>

export type CollectionOptionsIn<TClientContext extends ClientContext, TInput, TOutput, TError, TItem extends object, TKey extends string | number, TSchema extends AnySchema>
  = & (undefined extends TInput
    ? { input?: (context: QueryFunctionContext) => TInput }
    : { input: (context: QueryFunctionContext) => TInput })
  & (object extends TClientContext
    ? { context?: (context: QueryFunctionContext) => TClientContext }
    : { context: (context: QueryFunctionContext) => TClientContext })
  & { queryKey?: QueryKey | ((options: LoadSubsetOptions) => QueryKey) }
  & Omit<QueryCollectionConfig<TItem, CollectionQueryFn<TOutput>, TError, QueryKey, TKey, TSchema, TOutput>, 'queryKey' | 'queryFn' | 'select' | 'schema'>

export type CollectionOptionsOut<TItem extends object, TKey extends string | number, TSchema extends AnySchema, TInsertInput extends object, TError>
  = & CollectionConfig<TItem, TKey, TSchema, QueryCollectionUtils<TItem, TKey, TInsertInput, TError>>
    & { utils: QueryCollectionUtils<TItem, TKey, TInsertInput, TError> }

export interface MutationHandlerParams<TItem extends object = any, TType extends OperationType = OperationType> {
  transaction: TransactionWithMutations<TItem, TType>
  collection: Collection<TItem, any, any>
}

export type MutationHandlerOptionsIn<TClientContext extends ClientContext, TInput, TOutput, TItem extends object, TType extends OperationType, TReturn>
  = & (undefined extends TInput
    ? { input?: (mutation: PendingMutation<TItem, TType>, params: MutationHandlerParams<TItem, TType>) => TInput }
    : { input: (mutation: PendingMutation<TItem, TType>, params: MutationHandlerParams<TItem, TType>) => TInput })
  & (object extends TClientContext
    ? { context?: (mutation: PendingMutation<TItem, TType>, params: MutationHandlerParams<TItem, TType>) => TClientContext }
    : { context: (mutation: PendingMutation<TItem, TType>, params: MutationHandlerParams<TItem, TType>) => TClientContext })
  & { output?: (outputs: TOutput[], params: MutationHandlerParams<TItem, TType>) => TReturn }

export type MutationHandler<TItem extends object, TType extends OperationType, TReturn>
  = (params: MutationHandlerParams<TItem, TType>) => Promise<TReturn>
