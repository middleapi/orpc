import type { Context, MiddlewareOptions, ORPCErrorConstructorMap, ProcedureHandlerOptions } from '@orpc/server'
import type { Effect, Context as EffectContext } from 'effect'

/**
 * The options `effect/wrap` receives when wrapping the effect of a `middlewareGen`.
 *
 * @see {@link https://orpc.dev/docs/integrations/effect#error-handling | Effect Integration - Error Handling}
 */
export interface EffectWrapMiddlewareOptions extends Omit<MiddlewareOptions<Context, unknown, ORPCErrorConstructorMap<any>>, 'next'> {
  kind: 'middleware'
  /**
   * The middleware's input, validated by the schemas defined before it.
   */
  input: unknown
}

/**
 * The options `effect/wrap` receives when wrapping the effect of a `handlerGen`.
 *
 * @see {@link https://orpc.dev/docs/integrations/effect#error-handling | Effect Integration - Error Handling}
 */
export interface EffectWrapHandlerOptions extends ProcedureHandlerOptions<Context, unknown, ORPCErrorConstructorMap<any>> {
  kind: 'handler'
}

/**
 * The options `effect/wrap` receives, discriminated by `kind`.
 *
 * @see {@link https://orpc.dev/docs/integrations/effect#error-handling | Effect Integration - Error Handling}
 */
export type EffectWrapOptions = EffectWrapMiddlewareOptions | EffectWrapHandlerOptions

/**
 * A context shape that provides Effect services to effectful handlers
 * through the oRPC context in a typesafe way.
 *
 * @see {@link https://orpc.dev/docs/integrations/effect#effect-services | Effect Integration - Effect Services}
 */
export interface WithEffectContext<Services> {
  /**
   * A pre-built Effect context providing the services available within this oRPC context.
   * Automatically provided to any effect that runs under this context.
   *
   * References such as `Tracer`, `Logger` or `Scheduler` can be supplied here too.
   *
   * @example
   * ```ts
   * import { Context } from 'effect'
   *
   * interface ServerContext extends WithEffectContext<Random | Logger> {}
   *
   * const context: ServerContext = {
   *   'effect/context': Context.empty().pipe(
   *     Context.add(Random, { next: Effect.sync(() => Math.random()) }),
   *   ),
   * }
   * ```
   */
  ['effect/context']: EffectContext.Context<Services>

  /**
   * An optional hook to wrap an effect before it is executed within this oRPC context.
   * Useful for customizing error handling, such as mapping errors to `ORPCError`.
   *
   * Runs with `effect/context`, once per `middlewareGen` and `handlerGen` (see `opts.kind`).
   * Keep it idempotent, since failures from inner layers pass through it again.
   *
   * @see {@link https://orpc.dev/docs/integrations/effect#error-handling | Effect Integration - Error Handling}
   *
   * @example
   * ```ts
   * import { ORPCError } from '@orpc/server'
   * import { Context, Data, Effect } from 'effect'
   *
   * class NotFoundError extends Data.TaggedError('NotFoundError') {}
   *
   * interface ServerContext extends WithEffectContext<never> {}
   *
   * const context: ServerContext = {
   *   'effect/context': Context.empty(),
   *   'effect/wrap': effect => effect.pipe(
   *     Effect.mapError(error => error instanceof NotFoundError
   *       ? new ORPCError('NOT_FOUND', { cause: error })
   *       : error),
   *   ),
   * }
   * ```
   */
  ['effect/wrap']?: <A>(
    effect: Effect.Effect<A, unknown>,
    opts: EffectWrapOptions,
  ) => Effect.Effect<A, unknown>
}

/**
 * Infers the Effect services available in an oRPC context that extends `WithEffectContext`.
 *
 * @see {@link https://orpc.dev/docs/integrations/effect#effect-services | Effect Integration - Effect Services}
 */
export type InferEffectServices<T extends Context> = T extends WithEffectContext<infer Services> ? Services : never
