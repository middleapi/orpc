import type { ErrorMap } from '@orpc/contract'
import type { Context, Middleware, MiddlewareDone, MiddlewareNextOptions, MiddlewareOptions, MiddlewareResult, ORPCErrorConstructorMap } from '@orpc/server'
import type { MaybeOptionalOptions } from '@orpc/shared'
import type { InferEffectServices } from './context'
import { anyAbortSignal, isAsyncIteratorObject, resolveMaybeOptionalOptions } from '@orpc/shared'
import { Effect, Context as EffectContext } from 'effect'
import { runWithORPCContext } from './utils'

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
      fiberContext => Effect.callback<Awaited<MiddlewareResult<U, TOutput>>, unknown>((resume, interruptSignal) => {
        const nextOptions = resolveMaybeOptionalOptions(rest)
        // context can be undefined when all field is optional
        const nextContext: Context = nextOptions.context ?? {}

        const promise = (async () => opts.next<U>({
          context: {
            ...nextContext,
            'effect/context': layerChangedServices(fiberContext, nextContext['effect/context'], opts.context['effect/context']),
          },
          signal: anyAbortSignal([nextOptions.signal ?? opts.signal, interruptSignal]),
        } as any))()

        promise.then(
          result => resume(Effect.succeed(result)),
          error => resume(Effect.fail(error)),
        )

        // On interruption, wait for the chain to settle and close any iterator it returns.
        return Effect.promise(() => promise
          .then(({ output }) => isAsyncIteratorObject(output) ? output.return?.() : undefined)
          .catch(() => {}))
      }),
    )

    return runWithORPCContext(
      Effect.gen(() => middleware({ ...opts, next }, input, done)) as Effect.Effect<MiddlewareResult<TOutContext, TOutput>, unknown>,
      opts,
    )
  }

  Object.defineProperty(mid, 'name', { value: middleware.name })

  return mid
}

/**
 * The `effect/context` passed to `next` is the incoming one plus changes, so only the services
 * that differ from the incoming ones are layered over the fiber context, which keeps its newer span and annotations.
 */
function layerChangedServices(fiberContext: EffectContext.Context<never>, nextServices: unknown, incomingServices: unknown): EffectContext.Context<never> {
  if (!EffectContext.isContext(nextServices) || nextServices === incomingServices) {
    return fiberContext
  }

  const services = new Map(fiberContext.mapUnsafe)

  for (const [key, service] of nextServices.mapUnsafe) {
    if (!EffectContext.isContext(incomingServices) || incomingServices.mapUnsafe.get(key) !== service) {
      services.set(key, service)
    }
  }

  return EffectContext.makeUnsafe(services)
}
