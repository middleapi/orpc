import type { AnyFunction, SetOptional } from '@orpc/shared'
import type { DefaultError, MutationObserverOptions, QueryKey, QueryObserverOptions, UseInfiniteQueryOptions } from '@tanstack/vue-query'
import type { MaybeRef, MaybeRefOrGetter } from 'vue'

export type MaybeDeepRef<T> = MaybeRef<
  T extends AnyFunction
    ? T
    : T extends object
      ? {
          [K in keyof T]: MaybeDeepRef<T[K]>
        }
      : T
>

export type NonUndefinedGuard<T> = T extends undefined ? never : T

export type InferCursor<T> = T extends { cursor?: any } ? T['cursor'] : never

export type QueryOptions<TInput, TOutput, TClientContext, TSelectData> =
  & (undefined extends TInput ? { input?: MaybeDeepRef<TInput> } : { input: MaybeDeepRef<TInput> })
  & (undefined extends TClientContext ? { context?: MaybeDeepRef<TClientContext> } : { context: MaybeDeepRef<TClientContext> })
  & SetOptional<{
    [P in keyof QueryObserverOptions<TOutput, DefaultError, TSelectData, TOutput, QueryKey>]: P extends 'enabled'
      ? MaybeRefOrGetter<QueryObserverOptions<TOutput, DefaultError, TSelectData, TOutput, QueryKey>[P]>
      : MaybeDeepRef<QueryObserverOptions<TOutput, DefaultError, TSelectData, TOutput, QueryKey>[P]>
  }, 'queryKey'>
  & {
    shallow?: MaybeRef<boolean>
    initialData?: NonUndefinedGuard<TOutput> | (() => NonUndefinedGuard<TOutput>) | undefined
  }

export type InfiniteOptions<TInput, TOutput, TClientContext, TSelectData> =
  & (undefined extends TInput ? { input?: MaybeDeepRef<Omit<TInput, 'cursor'>> } : { input: MaybeDeepRef<Omit<TInput, 'cursor'>> })
  & (undefined extends TClientContext ? { context?: MaybeDeepRef<TClientContext> } : { context: MaybeDeepRef<TClientContext> })
  & SetOptional<
    UseInfiniteQueryOptions<TOutput, DefaultError, TSelectData, TOutput, QueryKey, InferCursor<TInput>>,
    'queryKey' | (undefined extends InferCursor<TInput> ? 'initialPageParam' : never)
  >

export type MutationOptions<TInput, TOutput, TClientContext> =
  & (undefined extends TClientContext ? { context?: MaybeDeepRef<TClientContext> } : { context: MaybeDeepRef<TClientContext> })
  & {
    [P in keyof MutationObserverOptions<TOutput, DefaultError, TInput, unknown>]: MaybeDeepRef<MutationObserverOptions<TOutput, DefaultError, TInput, unknown>[P]>
  }
  & {
    shallow?: MaybeRef<boolean>
  }
