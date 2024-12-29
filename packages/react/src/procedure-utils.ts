import type { ProcedureClient } from '@orpc/server'
import type { PartialOnUndefinedDeep, SetOptional } from '@orpc/shared'
import type {
  DefaultError,
  EnsureInfiniteQueryDataOptions,
  EnsureQueryDataOptions,
  FetchInfiniteQueryOptions,
  FetchQueryOptions,
  InfiniteData,
  QueryClient,
  QueryKey,
  QueryState,
  SetDataOptions,
  Updater,
} from '@tanstack/react-query'
import type { InferCursor, SchemaInputForInfiniteQuery } from './types'
import { getQueryKeyFromPath } from './tanstack-key'

export interface ProcedureUtils<TInput, TOutput> {
  fetchQuery: (
    input: TInput,
    options?: SetOptional<
      FetchQueryOptions<TOutput>,
      'queryKey' | 'queryFn'
    >,
  ) => Promise<TOutput>
  fetchInfiniteQuery: (
    options: PartialOnUndefinedDeep<
      SetOptional<
        FetchInfiniteQueryOptions<
          TOutput,
          DefaultError,
          TOutput,
          QueryKey,
          InferCursor<TInput>
        >,
        'queryKey' | 'queryFn'
      > & {
        input: SchemaInputForInfiniteQuery<TInput>
      }
    >,
  ) => Promise<
    InfiniteData<
      TOutput,
      InferCursor<TInput>
    >
  >

  prefetchQuery: (
    input: TInput,
    options?: SetOptional<
      FetchQueryOptions<TOutput>,
      'queryKey' | 'queryFn'
    >,
  ) => Promise<void>
  prefetchInfiniteQuery: (
    options: PartialOnUndefinedDeep<
      SetOptional<
        FetchInfiniteQueryOptions<
          TOutput,
          DefaultError,
          TOutput,
          QueryKey,
          InferCursor<TInput>
        >,
        'queryKey' | 'queryFn'
      > & {
        input: SchemaInputForInfiniteQuery<TInput>
      }
    >,
  ) => Promise<void>

  getQueryData: (
    input: TInput,
  ) => TOutput | undefined
  getInfiniteQueryData: (
    input: SchemaInputForInfiniteQuery<TInput>,
  ) => | InfiniteData<
    TOutput,
    InferCursor<TInput>
  >
  | undefined

  ensureQueryData: (
    input: TInput,
    options?: SetOptional<
      EnsureQueryDataOptions<TOutput>,
      'queryFn' | 'queryKey'
    >,
  ) => Promise<TOutput>
  ensureInfiniteQueryData: (
    options: PartialOnUndefinedDeep<
      SetOptional<
        EnsureInfiniteQueryDataOptions<
          TOutput,
          DefaultError,
          TOutput,
          QueryKey,
          InferCursor<TInput>
        >,
        'queryKey' | 'queryFn'
      > & {
        input: SchemaInputForInfiniteQuery<TInput>
      }
    >,
  ) => Promise<
    InfiniteData<
      TOutput,
      InferCursor<TInput>
    >
  >

  getQueryState: (
    input: TInput,
  ) => QueryState<TOutput> | undefined
  getInfiniteQueryState: (
    input: SchemaInputForInfiniteQuery<TInput>,
  ) => | QueryState<
    InfiniteData<
      TOutput,
      InferCursor<TInput>
    >
  >
  | undefined

  setQueryData: (
    input: TInput,
    updater: Updater<
      TOutput | undefined,
      TOutput | undefined
    >,
    options?: SetDataOptions,
  ) => TOutput | undefined
  setInfiniteQueryData: (
    input: SchemaInputForInfiniteQuery<TInput>,
    updater: Updater<
      | InfiniteData<
        TOutput,
        InferCursor<TInput>
      >
      | undefined,
      | InfiniteData<
        TOutput,
        InferCursor<TInput>
      >
      | undefined
    >,
    options?: SetDataOptions,
  ) => | InfiniteData<
    TOutput,
    InferCursor<TInput>
  >
  | undefined
}

export interface CreateProcedureUtilsOptions<TInput, TOutput> {
  client: ProcedureClient<TInput, TOutput, any>
  queryClient: QueryClient

  /**
   * The path of procedure on sever
   */
  path: string[]
}

export function createProcedureUtils<TInput, TOutput>(
  options: CreateProcedureUtilsOptions<TInput, TOutput>,
): ProcedureUtils<TInput, TOutput> {
  return {
    fetchQuery(input, options_) {
      return options.queryClient.fetchQuery({
        queryKey: getQueryKeyFromPath(options.path, { input, type: 'query' }),
        queryFn: ({ signal }) => options.client(input, { signal }),
        ...options_,
      })
    },
    fetchInfiniteQuery(options_) {
      const { input, ...rest } = options_
      return options.queryClient.fetchInfiniteQuery({
        queryKey: getQueryKeyFromPath(options.path, {
          input,
          type: 'infinite',
        }),
        queryFn: ({ pageParam, signal }) => {
          return options.client({ ...(input as any), pageParam } as any, { signal })
        },
        ...(rest as any),
      })
    },

    prefetchQuery(input, options_) {
      return options.queryClient.prefetchQuery({
        queryKey: getQueryKeyFromPath(options.path, {
          input,
          type: 'query',
        }),
        queryFn: ({ signal }) => options.client(input, { signal }),
        ...options_,
      })
    },
    prefetchInfiniteQuery(options_) {
      const { input, ...rest } = options_
      return options.queryClient.prefetchInfiniteQuery({
        queryKey: getQueryKeyFromPath(options.path, {
          input,
          type: 'infinite',
        }),
        queryFn: ({ pageParam, signal }) => {
          return options.client({ ...(input as any), cursor: pageParam } as any, { signal })
        },
        ...(rest as any),
      })
    },

    getQueryData(input) {
      return options.queryClient.getQueryData(
        getQueryKeyFromPath(options.path, {
          input,
          type: 'query',
        }),
      )
    },
    getInfiniteQueryData(input) {
      return options.queryClient.getQueryData(
        getQueryKeyFromPath(options.path, {
          input,
          type: 'infinite',
        }),
      )
    },

    ensureQueryData(input, options_) {
      return options.queryClient.ensureQueryData({
        queryKey: getQueryKeyFromPath(options.path, {
          input,
          type: 'query',
        }),
        queryFn: ({ signal }) => options.client(input, { signal }),
        ...options_,
      })
    },
    ensureInfiniteQueryData(options_) {
      const { input, ...rest } = options_
      return options.queryClient.ensureInfiniteQueryData({
        queryKey: getQueryKeyFromPath(options.path, {
          input,
          type: 'infinite',
        }),
        queryFn: ({ pageParam, signal }) => {
          return options.client({ ...(input as any), pageParam } as any, { signal })
        },
        ...(rest as any),
      })
    },

    getQueryState(input) {
      return options.queryClient.getQueryState(
        getQueryKeyFromPath(options.path, {
          input,
          type: 'query',
        }),
      )
    },
    getInfiniteQueryState(input) {
      return options.queryClient.getQueryState(
        getQueryKeyFromPath(options.path, {
          input,
          type: 'infinite',
        }),
      )
    },

    setQueryData(input, updater, options_) {
      return options.queryClient.setQueryData(
        getQueryKeyFromPath(options.path, {
          input,
          type: 'query',
        }),
        updater,
        options_,
      )
    },
    setInfiniteQueryData(input, updater, options_) {
      return options.queryClient.setQueryData(
        getQueryKeyFromPath(options.path, {
          input,
          type: 'infinite',
        }),
        updater,
        options_,
      )
    },
  }
}
