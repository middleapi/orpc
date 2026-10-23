import type { ErrorMap } from '@orpc/contract'
import type { Context, Middleware, MiddlewareDone, MiddlewareNextOptions, MiddlewareOptions, MiddlewareResult, ORPCErrorConstructorMap } from '@orpc/server'
import type { MaybeOptionalOptions } from '@orpc/shared'
import type { InferEffectServices, WithEffectContext } from './context'
import { anyAbortSignal, resolveMaybeOptionalOptions } from '@orpc/shared'
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
  TErrorConstructorMap extends ORPCErrorConstructorMap<any>,
  TYield extends Effect.Effect<any, any, InferEffectServices<TInContext>>,
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
  middleware: MiddlewareGen<TInContext, TOutContext, TInput, TOutput, ORPCErrorConstructorMap<TErrorMap>, TYield>,
): Middleware<TInContext, TOutContext, TInput, TOutput, TErrorMap> {
  const mid: Middleware<TInContext, TOutContext, TInput, TOutput, TErrorMap> = (opts, input, done) => {
    const next: MiddlewareGenNext<TOutput> = <U extends Context = object>(...rest: MaybeOptionalOptions<MiddlewareNextOptions<U>>) => Effect.contextWith(
      fiberContext => Effect.callback<Awaited<MiddlewareResult<U, TOutput>>, unknown>((resume, interruptSignal) => {
        const nextOptions = resolveMaybeOptionalOptions(rest)

        const promise = Promise.resolve(opts.next<U>({
          context: {
            ...nextOptions.context,
            'effect/context': layerChangedServices(fiberContext, nextOptions.context?.['effect/context'], opts.context['effect/context']),
          },
          signal: anyAbortSignal([nextOptions.signal ?? opts.signal, interruptSignal]),
        } as any))

        promise.then(
          result => resume(Effect.succeed(result)),
          error => resume(Effect.fail(error)),
        )

        // On interruption, wait for the chain to settle.
        return Effect.promise(() => promise.catch(() => {}))
      }),
    )

    const effectContext = opts.context['effect/context']
    const wrap = opts.context['effect/wrap'] as WithEffectContext<any>['effect/wrap']
    const ef = Effect.gen(() => middleware({ ...opts, next }, input, done)) as Effect.Effect<MiddlewareResult<TOutContext, TOutput>, unknown>

    let wrapped = ef
    if (typeof wrap === 'function') {
      const { next: _next, ...rest } = opts
      wrapped = wrap(ef, { ...rest, kind: 'middleware', input })
    }

    return runPromise(wrapped, {
      context: EffectContext.isContext(effectContext) ? effectContext : undefined,
      signal: opts.signal,
    })
  }

  Object.defineProperty(mid, 'name', { value: middleware.name })

  return mid
}

/**
 * An `effect/context` passed to `next` is the incoming one plus changes, so only the changed services
 * are layered over the fiber context, keeping the fiber's newer services, spans and log annotations.
 */
function layerChangedServices(fiberContext: EffectContext.Context<never>, nextServices: unknown, incomingServices: unknown): EffectContext.Context<never> {
  if (!EffectContext.isContext(nextServices) || nextServices === incomingServices) {
    return fiberContext
  }

  const services = new Map(fiberContext.mapUnsafe)

  for (const [key, service] of nextServices.mapUnsafe) {
    if (!EffectContext.isContext(incomingServices) || !incomingServices.mapUnsafe.has(key) || incomingServices.mapUnsafe.get(key) !== service) {
      services.set(key, service)
    }
  }

  return EffectContext.makeUnsafe(services)
}
