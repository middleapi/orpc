import { AbortError } from '@standardserver/shared'
import { Cause, Effect, Exit, FiberId } from 'effect'

/**
 * Extracts the most meaningful original error from an Effect Cause,
 * preserving the original error instance wherever possible.
 */
export function extractErrorFromCause(cause: Cause.Cause<unknown>): unknown {
  return Cause.match(cause, {
    onFail: error => error,
    onDie: defect => defect,
    onInterrupt: fiberId => new AbortError(`Fiber interrupted: ${FiberId.threadName(fiberId)}`),
    onEmpty: new Error('Effect failed with no error information'),

    // Mirrors native try/finally: if the finalizer (right) also throws,
    // it overwrites the original (left) — same behaviour as JS would produce
    onSequential: (_left, right) => right,
    onParallel: (left, _right) => left,
  })
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
