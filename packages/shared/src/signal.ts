import { throwIfAborted } from '@standard-server/shared'
import { promiseWithResolvers } from './promise'

export interface DisposableAllAbortSignal {
  signal: AbortSignal | undefined
  /**
   * Removes the listeners added to the input signals, after which `signal` never aborts.
   * Call it once `signal` is no longer needed, so long-lived input signals do not accumulate listeners.
   */
  dispose: () => void
}

/**
 * Like {@link allAbortSignal}, but also returns a `dispose` function
 * that removes the listeners added to the input signals.
 */
export function disposableAllAbortSignal(signals: readonly (AbortSignal | undefined)[]): DisposableAllAbortSignal {
  const realSignals = signals.filter(signal => signal !== undefined)

  if (realSignals.length === 0 || realSignals.length !== signals.length) {
    return { signal: undefined, dispose: () => {} }
  }

  const controller = new AbortController()
  const listenersController = new AbortController()
  const dispose = () => listenersController.abort()

  const abortIfAllAborted = () => {
    if (realSignals.every(signal => signal.aborted)) {
      controller.abort()
      dispose()
    }
  }

  abortIfAllAborted()

  if (!controller.signal.aborted) {
    for (const signal of realSignals) {
      signal.addEventListener('abort', abortIfAllAborted, {
        once: true,
        signal: listenersController.signal,
      })
    }
  }

  return { signal: controller.signal, dispose }
}

/**
 * Returns a signal that aborts only after all provided signals are aborted.
 *
 * @remarks
 * Its listeners on the input signals are removed only once all of them abort,
 * use {@link disposableAllAbortSignal} to remove them earlier.
 */
export function allAbortSignal(signals: readonly (AbortSignal | undefined)[]): AbortSignal | undefined {
  return disposableAllAbortSignal(signals).signal
}

/**
 * Returns a signal that aborts as soon as any of the provided signals aborts,
 * with the same abort reason.
 *
 * Prefers the native `AbortSignal.any` when available, and falls back to a manual
 * implementation otherwise, including in runtimes without the `AbortSignal` global.
 */
export function anyAbortSignal(signals: readonly (AbortSignal | undefined)[]): AbortSignal | undefined {
  const realSignals = signals.filter(signal => signal !== undefined)

  if (realSignals.length === 0) {
    return undefined
  }

  if (realSignals.length === 1) {
    return realSignals[0]
  }

  // eslint-disable-next-line no-restricted-globals
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    // eslint-disable-next-line ban/ban, no-restricted-globals
    return AbortSignal.any(realSignals)
  }

  const controller = new AbortController()

  for (const signal of realSignals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }

    signal.addEventListener('abort', () => {
      controller.abort(signal.reason)
    }, {
      once: true,
      signal: controller.signal,
    })
  }

  return controller.signal
}

export async function runWithSignal<T>(signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
  if (!signal) {
    return fn()
  }

  throwIfAborted(signal)
  const { promise, reject, resolve } = promiseWithResolvers<T>()
  let abortListener
  signal.addEventListener('abort', abortListener = () => {
    reject(signal.reason)
    abortListener = undefined
  })

  try {
    fn().then(resolve, reject)
    return await promise
  }
  finally {
    if (abortListener) {
      signal.removeEventListener('abort', abortListener)
    }
  }
}
