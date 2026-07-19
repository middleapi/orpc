import type { Client, ClientContext } from '@orpc/client'
import type { Interceptor, MaybeOptionalOptions, PromiseWithError } from '@orpc/shared'
import type { _EmptyObject, EntryKeyTagged, UseInfiniteQueryData, UseInfiniteQueryFnContext } from '@pinia/colada'
import type { InfiniteKeyOptions, InfiniteOptionsIn, InfiniteOptionsOut, MutationKeyOptions, MutationOptionsIn, MutationOptionsOut, OperationContext, QueryKeyOptions, QueryOptionsIn, QueryOptionsOut, UseMutationFnContext, UseQueryFnContext } from './types'
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

export interface ProcedureUtilsInfiniteInterceptorOptions<TClientContext extends ClientContext, TInput> {
  path: string[]
  context: TClientContext & OperationContext
  input: TInput
  fnContext: UseInfiniteQueryFnContext<any, any, any, any>
}
export type ProcedureUtilsInfiniteInterceptor<TClientContext extends ClientContext, TInput, TOutput, TError>
  = Interceptor<ProcedureUtilsInfiniteInterceptorOptions<TClientContext, TInput>, PromiseWithError<TOutput, TError>>

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
   * Key options modifier for .queryKey and .queryOptions
   * Can be partial options or a function that receives per-call options and returns override this.options.
   */
  queryKey?: ProcedureUtilsModifier<
    QueryKeyOptions<TInput>
  >

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
   * Key options modifier for .infiniteKey and .infiniteOptions
   * Can be partial options or a function that receives per-call options and returns override this.options.
   */
  infiniteKey?: ProcedureUtilsModifier<
    InfiniteKeyOptions<TInput, unknown>
  >

  /**
   * Interceptors that intercept query inside .infiniteOptions, guaranteed to be executed.
   */
  infiniteInterceptors?: ProcedureUtilsInfiniteInterceptor<TClientContext, TInput, TOutput, TError>[]

  /**
   * Options modifier for .infiniteOptions
   * Can be partial options or a function that receives per-call options and returns override this.options.
   */
  infiniteOptions?: ProcedureUtilsModifier<
    InfiniteOptionsIn<TClientContext, TInput, TOutput, TError, unknown, UseInfiniteQueryData<TOutput, unknown> | undefined>
  >

  /**
   * Key options modifier for .mutationKey and .mutationOptions
   * Can be partial options or a function that receives per-call options and returns override this.options.
   */
  mutationKey?: ProcedureUtilsModifier<
    MutationKeyOptions<TInput>
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
    private readonly prefix?: string,
  ) {
    this.call = client
  }

  /**
   * Generate a **full matching** key for useQuery/...
   *
   * @see {@link https://orpc.dev/docs/integrations/pinia-colada#query-mutation-key Pinia Colada Query/Mutation Key Docs}
   */
  queryKey(
    ...rest: MaybeOptionalOptions<QueryKeyOptions<TInput>>
  ): EntryKeyTagged<TOutput, TError> {
    let optionsIn = resolveMaybeOptionalOptions(rest)

    if (typeof this.options.queryKey === 'function') {
      optionsIn = this.options.queryKey(optionsIn)
    }
    else if (this.options.queryKey) {
      optionsIn = { ...this.options.queryKey, ...optionsIn }
    }

    const key = (optionsIn as any).key
      ?? buildKey(this.path, { prefix: this.prefix, type: 'query', input: (optionsIn as any).input })

    return key as EntryKeyTagged<TOutput, TError>
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
  ): NoInfer<QueryOptionsOut<TOutput, TError, UInitialData>> {
    let optionsIn = resolveMaybeOptionalOptions(rest)

    if (typeof this.options.queryOptions === 'function') {
      optionsIn = this.options.queryOptions(optionsIn as any) as any
    }
    else if (this.options.queryOptions) {
      optionsIn = { ...this.options.queryOptions, ...optionsIn } as any
    }

    const { input, context, key: _keyIn, query: queryIn, ...restOptions } = optionsIn as Record<string, any>

    const key = this.queryKey(optionsIn as QueryKeyOptions<TInput>)

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
   * Generate a **full matching** key for useInfiniteQuery/...
   *
   * @see {@link https://orpc.dev/docs/integrations/pinia-colada#query-mutation-key Pinia Colada Query/Mutation Key Docs}
   */
  infiniteKey<UPageParam>(
    optionsIn: InfiniteKeyOptions<TInput, UPageParam>,
  ): EntryKeyTagged<UseInfiniteQueryData<TOutput, UPageParam>, TError> {
    if (typeof this.options.infiniteKey === 'function') {
      optionsIn = this.options.infiniteKey(optionsIn as any) as any
    }
    else if (this.options.infiniteKey) {
      optionsIn = { ...this.options.infiniteKey, ...optionsIn } as any
    }

    const key = (optionsIn as any).key
      ?? buildKey(this.path, {
        prefix: this.prefix,
        type: 'infinite',
        input: (optionsIn as any).input(
          typeof (optionsIn as any).initialPageParam === 'function'
            ? (optionsIn as any).initialPageParam()
            : (optionsIn as any).initialPageParam,
        ),
      })

    return key as EntryKeyTagged<UseInfiniteQueryData<TOutput, UPageParam>, TError>
  }

  /**
   * Generate options used for useInfiniteQuery/...
   *
   * @see {@link https://orpc.dev/docs/integrations/pinia-colada#infinite-query-options-utility Pinia Colada Infinite Query Options Utility Docs}
   */
  infiniteOptions<UPageParam, UInitialData extends UseInfiniteQueryData<TOutput, UPageParam> | undefined = undefined>(
    optionsIn: InfiniteOptionsIn<TClientContext, TInput, TOutput, TError, UPageParam, UInitialData>,
  ): NoInfer<InfiniteOptionsOut<TOutput, TError, UPageParam, UInitialData>> {
    if (typeof this.options.infiniteOptions === 'function') {
      optionsIn = this.options.infiniteOptions(optionsIn as any) as any
    }
    else if (this.options.infiniteOptions) {
      optionsIn = { ...this.options.infiniteOptions, ...optionsIn } as any
    }

    const { input, context, key: _keyIn, query: queryIn, ...restOptions } = optionsIn as Record<string, any>

    const key = this.infiniteKey(optionsIn as InfiniteKeyOptions<TInput, UPageParam>)

    return {
      ...restOptions,
      key,
      query: (fnContext: UseInfiniteQueryFnContext<any, any, any, any>) => {
        return intercept(
          toArray(this.options.infiniteInterceptors),
          {
            path: this.path,
            context: {
              [OPERATION_CONTEXT_SYMBOL]: {
                key,
                type: 'infinite',
              },
              ...context,
            } satisfies OperationContext as any,
            input: input(fnContext.pageParam) as TInput,
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
   * Generate a **full matching** key for useMutation/...
   *
   * @see {@link https://orpc.dev/docs/integrations/pinia-colada#query-mutation-key Pinia Colada Query/Mutation Key Docs}
   */
  mutationKey(
    ...rest: MaybeOptionalOptions<MutationKeyOptions<TInput>>
  ): MutationOptionsOut<TInput, TOutput, TError, _EmptyObject>['key'] {
    let optionsIn = resolveMaybeOptionalOptions(rest)

    if (typeof this.options.mutationKey === 'function') {
      optionsIn = this.options.mutationKey(optionsIn)
    }
    else if (this.options.mutationKey) {
      optionsIn = { ...this.options.mutationKey, ...optionsIn }
    }

    const key = optionsIn.key
      ?? ((input: TInput) => buildKey(this.path, { prefix: this.prefix, type: 'mutation', input: input as any }))

    return key as MutationOptionsOut<TInput, TOutput, TError, _EmptyObject>['key']
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
  ): NoInfer<MutationOptionsOut<TInput, TOutput, TError, UMutationContext>> {
    let optionsIn = resolveMaybeOptionalOptions(rest)

    if (typeof this.options.mutationOptions === 'function') {
      optionsIn = this.options.mutationOptions(optionsIn as any) as any
    }
    else if (this.options.mutationOptions) {
      optionsIn = { ...this.options.mutationOptions, ...optionsIn } as any
    }

    const { context, key: _keyIn, mutation: mutationIn, ...restOptions } = optionsIn as Record<string, any>

    const key = this.mutationKey(optionsIn as MutationKeyOptions<TInput>)

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
