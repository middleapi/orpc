import type { AnySchema, ErrorMap, Meta } from '@orpc/contract'
import type { z } from 'zod'
import type { Context } from '../context'
import type { ORPCErrorConstructorMap } from '../error'
import type { MiddlewareNextFn } from '../middleware'
import type { Procedure } from '../procedure'

/**
 * Type utility to extract validated parameter types from a Zod schema record
 */
export type ValidatedParams<T extends Record<string, z.ZodSchema>> = {
  [K in keyof T]: z.infer<T[K]>
}

/**
 * Type utility to extend context with validated parameters
 */
export type ContextWithParams<T extends Record<string, z.ZodSchema>> = {
  params: ValidatedParams<T>
}

/**
 * Type utility to merge context with validated parameters
 */
export type MergedContextWithParams<
  TContext extends Record<string, any>,
  TParams extends Record<string, z.ZodSchema>,
> = TContext & ContextWithParams<TParams>

/**
 * Type utility for procedure handler options with validated parameters
 */
export interface ProcedureHandlerOptionsWithParams<
  TCurrentContext extends Context,
  TInput,
  TErrorConstructorMap extends ORPCErrorConstructorMap<any>,
  TMeta extends Meta,
  TParams extends Record<string, z.ZodSchema> = Record<string, z.ZodSchema>,
> {
  context: MergedContextWithParams<TCurrentContext, TParams>
  input: TInput
  path: readonly string[]
  procedure: Procedure<Context, Context, AnySchema, AnySchema, ErrorMap, TMeta>
  signal?: AbortSignal
  lastEventId: string | undefined
  errors: TErrorConstructorMap
  params: ValidatedParams<TParams>
}

/**
 * Type utility for middleware options with validated parameters
 */
export interface MiddlewareOptionsWithParams<
  TInContext extends Context,
  TOutput,
  TErrorConstructorMap extends ORPCErrorConstructorMap<any>,
  TMeta extends Meta,
  TParams extends Record<string, z.ZodSchema> = Record<string, z.ZodSchema>,
> {
  context: MergedContextWithParams<TInContext, TParams>
  path: readonly string[]
  procedure: Procedure<Context, Context, AnySchema, AnySchema, ErrorMap, TMeta>
  signal?: AbortSignal
  lastEventId: string | undefined
  next: MiddlewareNextFn<TOutput>
  errors: TErrorConstructorMap
  params: ValidatedParams<TParams>
}
