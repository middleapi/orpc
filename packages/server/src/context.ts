export interface Context {
  [key: PropertyKey]: any
}

export type MergedInitialContext<
  TInitial extends Context,
  TOutContext extends Context,
  TInContext extends Context,
> = Exclude<keyof TInContext, keyof TInitial | keyof TOutContext> extends never
  ? TInitial
  : TInitial & Omit<TInContext, keyof TInitial | keyof TOutContext>

export type MergedContext<
  TCurrent extends Context,
  TOutContext extends Context,
> = keyof TOutContext extends never
  ? TCurrent
  : Omit<TCurrent, keyof TOutContext> & TOutContext
