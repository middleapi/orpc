import type { DistributiveOmit } from '@orpc/shared'

export interface Context {
  [key: PropertyKey]: any
}

/**
 * Whether `T` requires nothing: only index signatures that accept any value,
 * like `Context` or `Record<string, unknown>`.
 */
type IsOpenContext<T> = string extends keyof T
  ? { [key: PropertyKey]: unknown } extends T
    ? keyof {
        [K in keyof T as Record<never, never> extends Record<K, unknown> ? never : K]: 0
      } extends never
      ? true
      : false
    : false
  : false

export type MergedInitialContext<
  TInitial extends Context,
  TOutContext extends Context,
  TInContext extends Context,
> = 0 extends 1 & TInContext
  ? TInitial
  : TInContext extends any
    ? Exclude<keyof TInContext, keyof TInitial | keyof TOutContext> extends never
      ? TInitial
      : IsOpenContext<DistributiveOmit<TInContext, keyof TInitial | keyof TOutContext>> extends true
        ? TInitial
        : TInitial & DistributiveOmit<TInContext, keyof TInitial | keyof TOutContext>
    : never

export type MergedContext<TCurrent extends Context, TOutContext extends Context> = 0 extends 1 &
  TOutContext
  ? TCurrent
  : TOutContext extends any
    ? keyof TOutContext extends never
      ? TCurrent
      : DistributiveOmit<TCurrent, keyof TOutContext> & TOutContext
    : never
