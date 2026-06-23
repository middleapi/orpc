import { AbortError } from '@orpc/shared'
import { Cause, Effect, Exit } from 'effect'

/**
 * Extracts the most meaningful original error from an Effect Cause,
 * preserving the original error instance wherever possible.
 */
export function extractErrorFromCause(cause: Cause.Cause<unknown>): unknown {
  if (cause.reasons.length === 0) {
    return new Error('Effect failed with no error information')
  }

  if (Cause.hasInterruptsOnly(cause)) {
    const [fiberId] = Cause.interruptors(cause)
    return new AbortError(`Fiber interrupted: ${fiberId === undefined ? 'unknown' : `#${fiberId}`}`)
  }

  return Cause.squash(cause)
}

export interface RunPromiseOptions {
  signal?: undefined | AbortSignal
}

/**
 * Runs an Effect as a Promise while re-throwing the original error directly,
 * bypassing Effect.runPromise's FiberFailure wrapper.
 */
export async function runPromise<T>(effect: Effect.Effect<T, unknown>, options: RunPromiseOptions = {}): Promise<T> {
  const exit = await Effect.runPromiseExit(effect, options)

  if (Exit.isSuccess(exit)) {
    return exit.value
  }

  throw extractErrorFromCause(exit.cause)
}
