import type { Context } from '@orpc/server'
import { anyAbortSignal } from '@orpc/shared'
import { Context as EffectContext } from 'effect'

/**
 * Aborts when the `next()` call that leads to the current effectful middleware or handler is interrupted.
 * Travels downstream inside `effect/context`, since oRPC does not let middleware override the downstream signal.
 *
 * @internal
 */
export class InterruptSignal extends EffectContext.Service<InterruptSignal, AbortSignal>()('@orpc/experimental-effect/InterruptSignal') {}

/**
 * Resolves the signal that interrupts an effectful middleware or handler:
 * either the request signal or the interruption of the upstream `next()` call.
 *
 * @internal
 */
export function resolveInterruptSignal(context: Context, signal: AbortSignal | undefined): AbortSignal | undefined {
  const effectContext = context['effect/context']

  return anyAbortSignal([
    signal,
    EffectContext.isContext(effectContext) ? EffectContext.getOrUndefined(effectContext, InterruptSignal) : undefined,
  ])
}
