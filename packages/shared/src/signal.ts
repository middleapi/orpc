import { promiseWithResolvers } from './promise'

/**
 * Returns a signal that aborts only after all provided signals are aborted.
 */
export function allAbortSignal(signals: readonly (AbortSignal | undefined)[]): AbortSignal | undefined {
  const realSignals = signals.filter(signal => signal !== undefined)

  if (realSignals.length === 0 || realSignals.length !== signals.length) {
    return undefined
  }

  const controller = new AbortController()

  const abortIfAllAborted = () => {
    if (realSignals.every(signal => signal.aborted)) {
      controller.abort()
    }
  }

  abortIfAllAborted()

  for (const signal of realSignals) {
    signal.addEventListener('abort', () => {
      abortIfAllAborted()
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

  signal.throwIfAborted()
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
