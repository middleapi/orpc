import type { AnyProcedure, Context } from '@orpc/server'
import type { WithEffectContext } from './context'
import { Effect, Context as EffectContext } from 'effect'
import { runPromise } from './runtime'

export interface RunWithORPCContextOptions {
  context: Context
  path: string[]
  procedure: AnyProcedure
  signal?: AbortSignal | undefined
}

/**
 * Runs an effectful middleware or handler with `effect/wrap` and `effect/context` applied.
 * `effect/wrap` runs inside `effect/context`, so it sees the provided services and parent span.
 */
export function runWithORPCContext<T>(effect: Effect.Effect<T, unknown>, opts: RunWithORPCContextOptions): Promise<T> {
  const { 'effect/context': context, 'effect/wrap': wrap } = opts.context as Partial<WithEffectContext<any>>

  if (typeof wrap === 'function') {
    effect = wrap(effect, opts)
  }

  if (EffectContext.isContext(context)) {
    effect = effect.pipe(Effect.provide(context))
  }

  return runPromise(effect, { signal: opts.signal })
}
