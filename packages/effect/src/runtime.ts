import { AbortError } from '@orpc/shared'
import { Cause, Context, Effect, Exit } from 'effect'

export interface RunPromiseOptions extends Effect.RunOptions {
  /**
   * The Effect context the effect runs with, including references such as `Tracer` or `Scheduler`.
   */
  context?: Context.Context<never> | undefined
}

/**
 * Runs an Effect as a Promise and throws the most meaningful errors.
 */
export async function runPromise<T>(effect: Effect.Effect<T, unknown>, options: RunPromiseOptions = {}): Promise<T> {
  const exit = await Effect.runPromiseExitWith(options.context ?? Context.empty())(effect, options)

  if (Exit.isSuccess(exit)) {
    return exit.value
  }

  // Use AbortError for interruption-only failures.
  // This is more meaningful than the generic
  // `Error("All fibers interrupted without error")` from Cause.squash.
  if (Cause.hasInterruptsOnly(exit.cause)) {
    if (options.signal?.aborted) {
      throw options.signal.reason
    }

    throw new AbortError('All fibers interrupted without error')
  }

  throw Cause.squash(exit.cause)
}
