import type { ErrorMap } from '@orpc/contract'
import type { Context, ORPCErrorConstructorMap, ProcedureHandler, ProcedureHandlerOptions } from '@orpc/server'
import type { InferEffectServices, WithEffectContext } from './context'
import { Effect, Context as EffectContext } from 'effect'
import { runPromise } from './runtime'

export type InferYieldError<Eff> = [Eff] extends [never] ? never : [Eff] extends [Effect.Effect<infer _A, infer E, infer _R>] ? E : never

export interface HandlerGen<
  TCurrentContext extends Context,
  TInput,
  TYield extends Effect.Effect<any, any, InferEffectServices<TCurrentContext>>,
  TReturn,
  TErrorConstructorMap extends ORPCErrorConstructorMap<any>,
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

/**
 * Creates a procedure handler from an Effect generator function.
 * Inside the generator you can yield Effect operations, and `handlerGen`
 * handles the execution and error handling for you.
 *
 * @see {@link https://orpc.dev/docs/integrations/effect#effectful-handlers | Effect Integration - Effectful Handlers}
 */
export function handlerGen<
  TCurrentContext extends Context,
  TInput,
  TYield extends Effect.Effect<any, any, InferEffectServices<TCurrentContext>>,
  TReturn,
  TErrorMap extends ErrorMap = Record<never, never>, // default is important for contract procedures without errors, whose error map is `object` and can't be inferred from
>(
  handler: HandlerGen<TCurrentContext, TInput, TYield, TReturn, ORPCErrorConstructorMap<TErrorMap>>,
): ProcedureHandler<TCurrentContext, TInput, TReturn, ORPCErrorConstructorMap<TErrorMap>> {
  return (opts, input) => {
    const effectContext = opts.context['effect/context']
    const wrap = opts.context['effect/wrap'] as WithEffectContext<any>['effect/wrap']
    const ef = Effect.gen(() => handler(opts, input)) as Effect.Effect<TReturn, InferYieldError<TYield>>

    return runPromise(
      typeof wrap === 'function' ? wrap(ef, { ...opts, kind: 'handler' }) : ef,
      { context: EffectContext.isContext(effectContext) ? effectContext : undefined, signal: opts.signal },
    )
  }
}
