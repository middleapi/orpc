import type { ErrorMap } from '@orpc/contract'
import type { Context, Middleware, MiddlewareDone, MiddlewareNextOptions, MiddlewareOptions, MiddlewareResult, ORPCErrorConstructorMap } from '@orpc/server'
import type { MaybeOptionalOptions } from '@orpc/shared'
import type { InferEffectServices, WithEffectContext } from './context'
import { anyAbortSignal, isAsyncIteratorObject, resolveMaybeOptionalOptions } from '@orpc/shared'
import { Effect, Context as EffectContext } from 'effect'
import { runPromise } from './runtime'

export interface MiddlewareGenNext<TOutput> {
  <U extends Context = object>(
    ...rest: MaybeOptionalOptions<MiddlewareNextOptions<U>>
  ): Effect.Effect<Awaited<MiddlewareResult<U, TOutput>>, unknown>
}

export interface MiddlewareGenOptions<
  TInContext extends Context,
  TOutput,
  TErrorConstructorMap extends ORPCErrorConstructorMap<any>,
> extends Omit<MiddlewareOptions<TInContext, TOutput, TErrorConstructorMap>, 'next'> {
  next: MiddlewareGenNext<TOutput>
}

export interface MiddlewareGen<
  TInContext extends Context,
  TOutContext extends Context,
  TInput,
  TOutput,
  TYield extends Effect.Effect<any, any, InferEffectServices<TInContext>>,
  TErrorConstructorMap extends ORPCErrorConstructorMap<any>,
> {
  (
    opts: MiddlewareGenOptions<TInContext, TOutput, TErrorConstructorMap>,
    input: TInput,
    done: MiddlewareDone<TOutput>,
  ): Generator<
    TYield,
    MiddlewareResult<TOutContext, TOutput>,
    never
  >
}

export type AnyMiddlewareGen = MiddlewareGen<any, any, any, any, any, any>

/**
 * Creates an oRPC middleware from an Effect generator function.
 * Inside the generator you can yield Effect operations and `yield* next()`
 * to continue the chain, and `middlewareGen` handles the execution and
 * error handling for you.
 *
 * `next()` is structured: the Effect context around it (services, spans, log annotations)
 * flows to downstream effectful middleware and handlers, and interrupting it aborts
 * the downstream chain and waits for it to settle before finalizers run.
 *
 * @see {@link https://orpc.dev/docs/integrations/effect#effectful-middleware | Effect Integration - Effectful Middleware}
 */
export function middlewareGen<
  TInContext extends Context,
  TOutContext extends Context = object,
  TInput = unknown,
  TOutput = any, // TOutput = any by default is important to make middleware can be used in any output by default
  TErrorMap extends ErrorMap = Record<never, never>,
  TYield extends Effect.Effect<any, any, InferEffectServices<TInContext>> = Effect.Effect<any, any, InferEffectServices<TInContext>>,
>(
  middleware: MiddlewareGen<TInContext, TOutContext, TInput, TOutput, TYield, ORPCErrorConstructorMap<TErrorMap>>,
): Middleware<TInContext, TOutContext, TInput, TOutput, TErrorMap> {
  const mid: Middleware<TInContext, TOutContext, TInput, TOutput, TErrorMap> = (opts, input, done) => {
    const next: MiddlewareGenNext<TOutput> = <U extends Context = object>(...rest: MaybeOptionalOptions<MiddlewareNextOptions<U>>) => Effect.contextWith(
      (fiberContext: EffectContext.Context<never>) => Effect.callback<Awaited<MiddlewareResult<U, TOutput>>, unknown>((resume, signal) => {
        const nextOptions = resolveMaybeOptionalOptions(rest)
        // context can be undefined when all field is optional
        const nextContext: Context = nextOptions.context ?? {}

        // Explicitly passed services are layered on top of the fiber context.
        const effectContext = EffectContext.isContext(nextContext['effect/context'])
          ? EffectContext.merge(fiberContext, nextContext['effect/context'])
          : fiberContext

        const promise = (async () => opts.next<U>({
          context: { ...nextContext, 'effect/context': effectContext } as unknown as U,
          // Interrupting the fiber aborts the downstream chain.
          signal: anyAbortSignal([nextOptions.signal ?? opts.signal, signal]),
        } as MiddlewareNextOptions<U>))()

        promise.then(
          result => resume(Effect.succeed(result)),
          error => resume(Effect.fail(error)),
        )

        // On interruption, wait for the downstream chain to settle so finalizers never run while it is still running.
        // An iterator returned after interruption has no consumer, so close it.
        return Effect.promise(() => promise
          .then(({ output }) => isAsyncIteratorObject(output) ? output.return?.() : undefined)
          .catch(() => {}))
      }),
    )

    let ef = Effect.gen(() => middleware({ ...opts, next }, input, done)) as Effect.Effect<MiddlewareResult<TOutContext, TOutput>, unknown>

    if (typeof opts.context['effect/wrap'] === 'function') {
      const intercept = opts.context['effect/wrap'] as Exclude<WithEffectContext<any>['effect/wrap'], undefined>
      ef = intercept(ef, opts)
    }

    // Provided outside `effect/wrap` so the wrap also runs with these services and nests under their span.
    if (EffectContext.isContext(opts.context['effect/context'])) {
      ef = ef.pipe(Effect.provide(opts.context['effect/context']))
    }

    return runPromise(ef, { signal: opts.signal })
  }

  Object.defineProperty(mid, 'name', { value: middleware.name })

  return mid
}
