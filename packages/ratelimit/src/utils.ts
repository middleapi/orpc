import type { Promisable } from '@orpc/shared'
import type { RateLimitOptions, RateLimitResult } from './types'
import { sleep } from '@orpc/shared'

/**
 * Reads the request weight, defaulting to 1.
 *
 * @throws {TypeError} when the weight is not an integer greater than 0
 */
export function resolveWeight(options?: RateLimitOptions): number {
  const weight = options?.weight ?? 1

  if (!Number.isInteger(weight) || weight <= 0) {
    throw new TypeError('Rate limit weight must be an integer greater than 0')
  }

  return weight
}

/**
 * Runs `check`, and while it fails, retries each time the window resets
 * before `timeout` milliseconds elapse. Resolves with the last result.
 */
export async function blockUntilReady(
  check: () => Promisable<Required<RateLimitResult>>,
  timeout: number,
): Promise<Required<RateLimitResult>> {
  if (timeout <= 0) {
    return check()
  }

  const deadline = Date.now() + timeout

  while (true) {
    const result = await check()

    if (result.success || result.reset > deadline) {
      return result
    }

    await sleep(result.reset - Date.now())
  }
}
