/**
 * Error for an operation that exceeded its time limit.
 * Named like the error of `AbortSignal.timeout()`.
 *
 * @see {@link https://orpc.dev/docs/plugins/timeout | Timeout Plugin}
 */
export class TimeoutError extends Error {
  override readonly name = 'TimeoutError'
}

export function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name.includes('Abort')
}
