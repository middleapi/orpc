import type { Client, ClientContext } from '@orpc/client'
import type { AnySchema } from '@orpc/contract'
import type { MaybeOptionalOptions } from '@orpc/shared'
import type { OperationKeyPrefixOptions, TanstackQueryOperationContext } from '@orpc/tanstack-query'
import type { OperationType } from '@tanstack/db'
import type {
  CollectionOptionsIn,
  CollectionOptionsOut,
  InferCollectionItem,
  InferCollectionSchemaInput,
  InferCollectionSchemaOutput,
  MutationHandler,
  MutationHandlerOptionsIn,
} from './types'
import { resolveMaybeOptionalOptions } from '@orpc/shared'
import { generateOperationKey, TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL } from '@orpc/tanstack-query'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

export interface ProcedureUtilsOptions extends OperationKeyPrefixOptions {
}

export class ProcedureUtils<TClientContext extends ClientContext, TInput, TOutput, TError> {
  /**
   * Calling corresponding procedure client
   */
  call: Client<TClientContext, TInput, TOutput, TError>

  constructor(
    private readonly path: string[],
    client: Client<TClientContext, TInput, TOutput, TError>,
    private readonly options: ProcedureUtilsOptions = {},
  ) {
    this.call = client
  }

  /**
   * Generate options used with `createCollection` from [TanStack DB](https://tanstack.com/db).
   * Built on top of `queryCollectionOptions` from `@tanstack/query-db-collection`.
   */
  collectionOptions<USchema extends AnySchema, UKey extends string | number = string | number>(
    options: & CollectionOptionsIn<TClientContext, TInput, TOutput, TError, InferCollectionSchemaOutput<USchema>, UKey, USchema>
      & { schema: USchema }
      & (TOutput extends InferCollectionSchemaOutput<USchema>[]
        ? { select?: (data: TOutput) => InferCollectionSchemaInput<USchema>[] }
        : { select: (data: TOutput) => InferCollectionSchemaInput<USchema>[] })
  ): CollectionOptionsOut<InferCollectionSchemaOutput<USchema>, UKey, USchema, InferCollectionSchemaInput<USchema>, TError> & { schema: USchema }

  collectionOptions<UItem extends object = InferCollectionItem<TOutput>, UKey extends string | number = string | number>(
    options: & CollectionOptionsIn<TClientContext, TInput, TOutput, TError, UItem, UKey, never>
      & { schema?: never }
      & (TOutput extends UItem[] ? { select?: (data: TOutput) => UItem[] } : { select: (data: TOutput) => UItem[] })
  ): CollectionOptionsOut<UItem, UKey, never, UItem, TError> & { schema?: never }

  collectionOptions(optionsIn: any): any {
    const { input, context, queryKey, queryFn, ...rest } = optionsIn

    return queryCollectionOptions({
      ...rest,
      queryKey: queryKey ?? (options => generateOperationKey(this.path, {
        prefix: this.options.prefix,
        type: 'query',
        input: input?.(options),
      })),
      queryFn: queryFn ?? ((fnContext) => {
        return this.call(input?.(fnContext.meta!.loadSubsetOptions!), {
          signal: fnContext.signal,
          context: {
            [TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL]: {
              key: fnContext.queryKey,
              type: 'query',
            },
            ...context?.(fnContext),
          } satisfies TanstackQueryOperationContext,
        })
      }),
    })
  }

  /**
   * Create a persistence handler for [TanStack DB](https://tanstack.com/db) collections.
   * Can be used as `onInsert`, `onUpdate`, or `onDelete` in collection options.
   */
  mutationHandler<UItem extends object = any, UType extends OperationType = OperationType, UReturn = undefined>(
    ...rest: MaybeOptionalOptions<MutationHandlerOptionsIn<TClientContext, TInput, TOutput, UItem, UType, UReturn>>
  ): MutationHandler<UItem, UType, UReturn> {
    const optionsIn = resolveMaybeOptionalOptions(rest)

    const mutationKey = generateOperationKey(this.path, { prefix: this.options.prefix, type: 'mutation' })

    return async (params) => {
      const outputs = await Promise.all(params.transaction.mutations.map((mutation) => {
        const context = {
          [TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL]: {
            key: mutationKey,
            type: 'mutation',
          },
          ...optionsIn.context?.(mutation, params),
        } satisfies TanstackQueryOperationContext

        return this.call(optionsIn.input?.(mutation, params) as TInput, { context: context as any })
      }))

      return optionsIn.output?.(outputs, params) as any
    }
  }
}
