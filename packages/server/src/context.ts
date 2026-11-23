import type { DistributiveOmit } from '@orpc/shared'

/**
 * The base shape of a context.
 *
 * @see {@link https://orpc.dev/docs/context | Context}
 */
export interface Context {
  [key: PropertyKey]: any
}

export type MergedInitialContext<
  TInitial extends Context,
  TOutContext extends Context,
  TInContext extends Context,
> = 0 extends 1 & TInContext
  ? TInitial
  : TInContext extends any
    ? Exclude<keyof TInContext, keyof TInitial | keyof TOutContext> extends never
      ? TInitial
      : { [key: PropertyKey]: unknown } extends Required<
            DistributiveOmit<TInContext, keyof TInitial | keyof TOutContext>
          >
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
