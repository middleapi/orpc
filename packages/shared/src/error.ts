/**
 * Error used when an operation exceeds its time limit, such as the reason
 * the timeout plugins abort a signal with. Uses the standardized `TimeoutError` name,
 * the same one `AbortSignal.timeout()` uses, so both can be matched by `error.name`.
 * Unlike an `AbortError`, it is a failure, not a cancellation.
 *
 * @see {@link https://orpc.dev/docs/plugins/timeout#handling-timeouts | Timeout Plugin - Handling Timeouts}
 */
export class TimeoutError extends Error {
  override readonly name = 'TimeoutError'
}

/**
 * Whether the error is a cancellation: an `Error` whose name contains `Abort`.
 * Failures such as a `TimeoutError` or a closed connection are not aborts.
 */
export function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name.includes('Abort')
}
