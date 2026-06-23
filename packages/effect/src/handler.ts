import type { AnyORPCError, Context, ORPCErrorConstructorMap, ProcedureHandler, ProcedureHandlerOptions } from '@orpc/server'
import type { WithEffectContext } from './context'
import { ORPCError } from '@orpc/server'
import { Effect, Context as EffectContext } from 'effect'
import { runPromise } from './runtime'

export type InferYieldError<Eff> = [Eff] extends [never] ? never : [Eff] extends [Effect.Effect<infer _A, infer E, infer _R>] ? E : never

export interface HandlerGen<
  TCurrentContext extends Context,
  TInput,
  TYield extends Effect.Effect<
    any,
    any,
    TCurrentContext extends WithEffectContext<infer S> ? S : never
  >,
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

const succeedOnORPCError = Effect.catch(error => error instanceof ORPCError ? Effect.succeed(error) : Effect.fail(error))

export function handlerGen<
  TCurrentContext extends Context,
  TInput,
  TErrorConstructorMap extends ORPCErrorConstructorMap<any>,
  TYield extends Effect.Effect<
    any,
    any,
    TCurrentContext extends WithEffectContext<infer S> ? S : never
  >,
  TReturn,
>(
  handler: HandlerGen<TCurrentContext, TInput, TYield, TReturn, TErrorConstructorMap>,
): ProcedureHandler<TCurrentContext, TInput, TReturn | Extract<InferYieldError<TYield>, AnyORPCError>, TErrorConstructorMap> {
  return (opts, input) => {
    let ef = Effect
      .gen(() => handler(opts, input))
      .pipe(succeedOnORPCError) as Effect.Effect<TReturn | Extract<InferYieldError<TYield>, AnyORPCError>, Exclude<InferYieldError<TYield>, AnyORPCError>>

    if (EffectContext.isContext(opts.context['~effect/context'])) {
      ef = ef.pipe(Effect.provide(opts.context['~effect/context']))
    }

    // MUST wrap after `.pipe(succeedOnORPCError)`.
    // Otherwise, an ORPCError thrown by intercept would be incorrectly marked as an inferable error.
    if (typeof opts.context['~effect/wrap'] === 'function') {
      const intercept = opts.context['~effect/wrap'] as Exclude<WithEffectContext<any>['~effect/wrap'], undefined>
      ef = intercept(ef, opts)
    }

    return runPromise(ef, { signal: opts.signal })
  }
}
