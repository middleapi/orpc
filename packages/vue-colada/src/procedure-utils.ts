import type { Client, ClientContext } from '@orpc/client'
import type { Interceptor, MaybeOptionalOptions, PromiseWithError } from '@orpc/shared'
import type { _EmptyObject } from '@pinia/colada'
import type { MutationOptions, MutationOptionsIn, OperationContext, QueryOptions, QueryOptionsIn, UseMutationFnContext, UseQueryFnContext } from './types'
import { intercept, resolveMaybeOptionalOptions, toArray } from '@orpc/shared'
import { buildKey } from './key'
import { OPERATION_CONTEXT_SYMBOL } from './types'

export interface ProcedureUtilsQueryInterceptorOptions<TClientContext extends ClientContext, TInput> {
  path: string[]
  context: TClientContext & OperationContext
  input: TInput
  fnContext: UseQueryFnContext
}
export type ProcedureUtilsQueryInterceptor<TClientContext extends ClientContext, TInput, TOutput, TError>
  = Interceptor<ProcedureUtilsQueryInterceptorOptions<TClientContext, TInput>, PromiseWithError<TOutput, TError>>

export interface ProcedureUtilsMutationInterceptorOptions<TClientContext extends ClientContext, TInput> {
  path: string[]
  context: TClientContext & OperationContext
  input: TInput
  fnContext: UseMutationFnContext
}
export type ProcedureUtilsMutationInterceptor<TClientContext extends ClientContext, TInput, TOutput, TError>
  = Interceptor<ProcedureUtilsMutationInterceptorOptions<TClientContext, TInput>, PromiseWithError<TOutput, TError>>

/**
 * Can be partial options for spread-merged options,
 * or a function that receives per-call options and returns overridden this.options.
 */
export type ProcedureUtilsModifier<T extends object> = Partial<T> | ((options: T) => T)

export interface ProcedureUtilsOptions<TClientContext extends ClientContext, TInput, TOutput, TError> {
  /**
   * Interceptors that intercept query inside .queryOptions, guaranteed to be executed.
   */
  queryInterceptors?: ProcedureUtilsQueryInterceptor<TClientContext, TInput, TOutput, TError>[]

  /**
   * Options modifier for .queryOptions
   * Can be partial options or a function that receives per-call options and returns override this.options.
   */
  queryOptions?: ProcedureUtilsModifier<
    QueryOptionsIn<TClientContext, TInput, TOutput, TError, TOutput | undefined>
  >

  /**
   * Interceptors that intercept mutation inside .mutationOptions, guaranteed to be executed.
   */
  mutationInterceptors?: ProcedureUtilsMutationInterceptor<TClientContext, TInput, TOutput, TError>[]

  /**
   * Options modifier for .mutationOptions
   * Can be partial options or a function that receives per-call options and returns override this.options.
   */
  mutationOptions?: ProcedureUtilsModifier<
    MutationOptionsIn<TClientContext, TInput, TOutput, TError, Record<any, any>>
  >
}

export class ProcedureUtils<TClientContext extends ClientContext, TInput, TOutput, TError> {
  /**
   * Calling corresponding procedure client
   *
   * @see {@link https://orpc.dev/docs/integrations/pinia-colada#calling-procedure-clients Pinia Colada Calling Procedure Client Docs}
   */
  call: Client<TClientContext, TInput, TOutput, TError>

  constructor(
    private readonly path: string[],
    client: Client<TClientContext, TInput, TOutput, TError>,
    private readonly options: ProcedureUtilsOptions<TClientContext, TInput, TOutput, TError> = {},
  ) {
    this.call = client
  }

  /**
   * Generate options used for useQuery/...
   *
   * @see {@link https://orpc.dev/docs/integrations/pinia-colada#query-options-utility Pinia Colada Query Options Utility Docs}
   */
  queryOptions<UInitialData extends TOutput | undefined = TOutput | undefined>(
    ...rest: MaybeOptionalOptions<
      QueryOptionsIn<TClientContext, TInput, TOutput, TError, UInitialData>
    >
  ): NoInfer<QueryOptions<TOutput, TError, UInitialData>> {
    let optionsIn = resolveMaybeOptionalOptions(rest)

    if (typeof this.options.queryOptions === 'function') {
      optionsIn = this.options.queryOptions(optionsIn as any) as any
    }
    else if (this.options.queryOptions) {
      optionsIn = { ...this.options.queryOptions, ...optionsIn } as any
    }

    const { input, context, key: keyIn, query: queryIn, ...restOptions } = optionsIn as Record<string, any>

    const key = keyIn ?? buildKey(this.path, { type: 'query', input })

    return {
      ...restOptions,
      key,
      query: (fnContext: UseQueryFnContext) => {
        return intercept(
          toArray(this.options.queryInterceptors),
          {
            path: this.path,
            context: {
              [OPERATION_CONTEXT_SYMBOL]: {
                key,
                type: 'query',
              },
              ...context,
            } satisfies OperationContext as any,
            input: input as TInput,
            fnContext,
          },
          ({ context, input, fnContext }) => {
            if (queryIn) {
              return queryIn(fnContext) as PromiseWithError<TOutput, TError>
            }

            return this.call(input, { signal: fnContext.signal, context })
          },
        )
      },
    } as any
  }

  /**
   * Generate options used for useMutation/...
   *
   * @see {@link https://orpc.dev/docs/integrations/pinia-colada#mutation-options Pinia Colada Mutation Options Docs}
   */
  mutationOptions<UMutationContext extends Record<any, any> = _EmptyObject>(
    ...rest: MaybeOptionalOptions<
      MutationOptionsIn<TClientContext, TInput, TOutput, TError, UMutationContext>
    >
  ): NoInfer<MutationOptions<TInput, TOutput, TError, UMutationContext>> {
    let optionsIn = resolveMaybeOptionalOptions(rest)

    if (typeof this.options.mutationOptions === 'function') {
      optionsIn = this.options.mutationOptions(optionsIn as any) as any
    }
    else if (this.options.mutationOptions) {
      optionsIn = { ...this.options.mutationOptions, ...optionsIn } as any
    }

    const { context, key: keyIn, mutation: mutationIn, ...restOptions } = optionsIn as Record<string, any>

    const key = keyIn ?? ((input: TInput) => buildKey(this.path, { type: 'mutation', input: input as any }))

    return {
      ...restOptions,
      key,
      mutation: (input: TInput, fnContext: UseMutationFnContext) => {
        return intercept(
          toArray(this.options.mutationInterceptors),
          {
            path: this.path,
            context: {
              [OPERATION_CONTEXT_SYMBOL]: {
                key: typeof key === 'function' ? key(input) : key,
                type: 'mutation',
              },
              ...context,
            } satisfies OperationContext as any,
            input,
            fnContext,
          },
          ({ context, input, fnContext }) => {
            if (mutationIn) {
              return mutationIn(input, fnContext) as PromiseWithError<TOutput, TError>
            }

            return this.call(input, { context })
          },
        )
      },
    } as any
  }
}
