import type { AnyProcedure } from '@orpc/server'
import type { Effect, Context as EffectContext } from 'effect'

export interface WithEffectContext<Services> {
  /**
   * A pre-built Effect context providing the services available within this oRPC context.
   * Automatically provided to any effect that runs under this context.
   *
   * @example
   * ```ts
   * import { Context } from 'effect'
   *
   * interface ServerContext extends WithEffectContext<Random | Logger> {}
   *
   * const context: ServerContext = {
   *   '~effect/context': Context.empty().pipe(
   *     Context.add(Random, { next: Effect.sync(() => Math.random()) }),
   *   ),
   * }
   * ```
   */
  ['~effect/context']: EffectContext.Context<Services>

  /**
   * An optional hook to wrap any effect before it is executed within this oRPC context.
   * Useful for adding observability, tracing, or error handling.
   *
   * @example
   * ```ts
   * import { Resource, Tracer } from '@effect/opentelemetry'
   * import { Context, Effect, Layer } from 'effect'
   *
   * interface ServerContext extends WithEffectContext<never> {}
   *
   * const TracingLive = Tracer.layerGlobal.pipe(
   *   Layer.provide(Resource.layerFromEnv()),
   * )
   *
   * const context: ServerContext = {
   *   '~effect/context': Context.empty(),
   *   '~effect/wrap': (effect) => effect.pipe(Effect.provide(TracingLive)),
   * }
   * ```
   */
  ['~effect/wrap']?: <A, E>(
    effect: Effect.Effect<A, E>,
    opts: { path: string[], procedure: AnyProcedure, signal?: undefined | AbortSignal },
  ) => Effect.Effect<A, E>
}
