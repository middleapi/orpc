import type { Context, ORPCErrorConstructorMap, ProcedureHandler, ProcedureHandlerOptions } from '@orpc/server'
import type { InferEffectServices, WithEffectContext } from './context'
import { Effect, Context as EffectContext } from 'effect'
import { runPromise } from './runtime'

export interface HandlerGen<
  TCurrentContext extends Context,
  TInput,
  TReturn,
  TErrorConstructorMap extends ORPCErrorConstructorMap<any>,
  TYield extends Effect.Effect<any, any, InferEffectServices<TCurrentContext>>,
> {
  (
    opts: ProcedureHandlerOptions<TCurrentContext, TInput, TErrorConstructorMap>,
    input: TInput,
  ): Generator<
    TYield,
    TReturn,
    never
  >
}

export type AnyHandlerGen = HandlerGen<any, any, any, any, any>

/**
 * Creates a procedure handler from an Effect generator function.
 * Inside the generator you can yield Effect operations, and `handlerGen`
 * handles the execution and error handling for you.
 *
 * @see {@link https://orpc.dev/docs/integrations/effect#effectful-handlers | Effect Integration - Effectful Handlers}
 */
export function handlerGen<
  TCurrentContext extends Context,
  TInput = unknown,
  TReturn = unknown,
  TErrorConstructorMap extends ORPCErrorConstructorMap<any> = ORPCErrorConstructorMap<Record<never, never>>,
  TYield extends Effect.Effect<any, any, InferEffectServices<TCurrentContext>> = Effect.Effect<any, any, InferEffectServices<TCurrentContext>>,
>(
  handler: HandlerGen<TCurrentContext, TInput, TReturn, TErrorConstructorMap, TYield>,
): ProcedureHandler<TCurrentContext, TInput, TReturn, TErrorConstructorMap> {
  return (opts, input) => {
    let ef = Effect.gen(() => handler(opts, input)) as Effect.Effect<TReturn, unknown>

    if (EffectContext.isContext(opts.context['effect/context'])) {
      ef = ef.pipe(Effect.provide(opts.context['effect/context']))
    }

    if (typeof opts.context['effect/wrap'] === 'function') {
      const intercept = opts.context['effect/wrap'] as Exclude<WithEffectContext<any>['effect/wrap'], undefined>
      ef = intercept(ef, opts)
    }

    return runPromise(ef, { signal: opts.signal })
  }
}
