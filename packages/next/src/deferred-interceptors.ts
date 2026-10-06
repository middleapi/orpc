import { onError, onFinish, onStart, onSuccess } from '@orpc/shared'
import { unstable_rethrow } from 'next/navigation'

/**
 * Like `onStart`, but defers execution, useful for updating states.
 *
 * @see {@link https://orpc.dev/docs/integrations/next#hooks | Next.js Integration - Hooks}
 */
export const onStartDeferred: typeof onStart = (callback, ...rest) => {
  return onStart((...args) => {
    setTimeout(() => {
      callback(...args)
    }, 6)
  }, ...rest)
}

/**
 * Like `onSuccess`, but defers execution, useful for updating states.
 *
 * @see {@link https://orpc.dev/docs/integrations/next#hooks | Next.js Integration - Hooks}
 */
export const onSuccessDeferred: typeof onSuccess = (callback, ...rest) => {
  return onSuccess((...args) => {
    setTimeout(() => {
      callback(...args)
    }, 6)
  }, ...rest)
}

/**
 * Like `onError`, but defers execution, useful for updating states.
 * Special Next.js errors such as `redirect` and `notFound` are ignored.
 *
 * @see {@link https://orpc.dev/docs/integrations/next#hooks | Next.js Integration - Hooks}
 */
export const onErrorDeferred: typeof onError = (callback, ...rest) => {
  return onError((...args) => {
    if (isNextSpecialError(args[0])) {
      return
    }

    setTimeout(() => {
      callback(...args)
    }, 6)
  }, ...rest)
}

/**
 * Like `onFinish`, but defers execution, useful for updating states.
 *
 * @see {@link https://orpc.dev/docs/integrations/next#hooks | Next.js Integration - Hooks}
 */
export const onFinishDeferred: typeof onFinish = (callback, ...rest) => {
  return onFinish((...args) => {
    setTimeout(() => {
      callback(...args)
    }, 6)
  }, ...rest)
}

/**
 * Whether the error is a special Next.js error (redirect, notFound, ...) that should not be treated as a failure.
 * https://nextjs.org/docs/app/api-reference/functions/unstable_rethrow
 */
function isNextSpecialError(error: unknown): boolean {
  try {
    unstable_rethrow(error)
    return false
  }
  catch {
    return true
  }
}
