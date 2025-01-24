import type { AbortSignal, ErrorMap, Meta, ORPCErrorConstructorMap, Schema } from '@orpc/contract'
import type { Promisable } from '@orpc/shared'
import type { Context } from './context'
import type { Procedure } from './procedure'

export type MiddlewareResult<TOutContext extends Context, TOutput> = Promisable<{
  output: TOutput
  context: TOutContext
}>

export type MiddlewareNextFnOptions<TOutContext extends Context> = Record<never, never> extends TOutContext
  ? { context?: TOutContext }
  : { context: TOutContext }

export type MiddlewareNextFnRest<TOutContext extends Context> =
  | [options: MiddlewareNextFnOptions<TOutContext>]
  | (Record<never, never> extends TOutContext ? [] : never)

export interface MiddlewareNextFn<TInContext extends Context, TOutput> {
  <U extends Context & Partial<TInContext> = Record<never, never>>(...rest: MiddlewareNextFnRest<U>): MiddlewareResult<U, TOutput>
}

export interface MiddlewareOutputFn<TOutput> {
  (output: TOutput): MiddlewareResult<Record<never, never>, TOutput>
}

export interface MiddlewareOptions<
  TInContext extends Context,
  TOutput,
  TErrorConstructorMap extends ORPCErrorConstructorMap<any>,
  TMeta extends Meta,
> {
  context: TInContext
  path: string[]
  procedure: Procedure<Context, Context, Schema, Schema, unknown, ErrorMap, TMeta>
  signal?: AbortSignal
  next: MiddlewareNextFn<TInContext, TOutput>
  errors: TErrorConstructorMap
}

export interface Middleware<
  TInContext extends Context,
  TOutContext extends Context,
  TInput,
  TOutput,
  TErrorConstructorMap extends ORPCErrorConstructorMap<any>,
  TMeta extends Meta,
> {
  (
    options: MiddlewareOptions<TInContext, TOutput, TErrorConstructorMap, TMeta>,
    input: TInput,
    output: MiddlewareOutputFn<TOutput>,
  ): Promisable<
    MiddlewareResult<TOutContext, TOutput>
  >
}

export type AnyMiddleware = Middleware<any, any, any, any, any, any>

export interface MapInputMiddleware<TInput, TMappedInput> {
  (input: TInput): TMappedInput
}

export function middlewareOutputFn<TOutput>(output: TOutput): MiddlewareResult<Record<never, never>, TOutput> {
  return { output, context: {} }
}
