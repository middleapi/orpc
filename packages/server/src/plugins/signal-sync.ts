import type { ErrorMap, Schema } from '@orpc/contract'
import type { StandardHandlerOptions, StandardHandlerPlugin } from '../adapters/standard'
import type { Context } from '../context'
import type { ProcedureClientInterceptor } from '../procedure-client'
import { AbortError, anyAbortSignal, AsyncIteratorClass, isAsyncIteratorObject, override, runWithSignal, toArray } from '@orpc/shared'

/**
 * Keeps the request signal and a streaming output (async iterator object or readable stream) in sync:
 * cancelling the output aborts the signal with an `AbortError`,
 * and aborting the signal ends the output with the abort reason and cancels it.
 *
 * @see {@link https://orpc.dev/docs/plugins/signal-sync | Signal Sync Plugin}
 */
export class SignalSyncHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~signal-sync'

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const clientInterceptor: ProcedureClientInterceptor<T, Schema<unknown>, ErrorMap> = async (interceptorOptions) => {
      const controller = new AbortController()
      const signal = anyAbortSignal([interceptorOptions.signal, controller.signal])!
      const cancel = () => controller.abort(new AbortError('The response body was cancelled'))

      const output = await interceptorOptions.next({ ...interceptorOptions, signal })

      if (isAsyncIteratorObject(output)) {
        return override(output, syncAsyncIterator(output, signal, cancel))
      }

      if (output instanceof ReadableStream) {
        return override(output, syncReadableStream(output, signal, cancel))
      }

      return output
    }

    return { ...options, clientInterceptors: [clientInterceptor, ...toArray(options.clientInterceptors)] }
  }
}

function listenAbort(signal: AbortSignal, onAbort: () => void): () => void {
  if (signal.aborted) {
    onAbort()
  }
  else {
    signal.addEventListener('abort', onAbort, { once: true })
  }

  return () => signal.removeEventListener('abort', onAbort)
}

function syncAsyncIterator(iterator: AsyncIterator<unknown, unknown>, signal: AbortSignal, cancel: () => void) {
  let cancelling: Promise<unknown> | undefined

  const unlisten = listenAbort(signal, () => {
    cancelling = (async () => iterator.return?.())()
    cancelling.catch(() => {}) // only awaited when the consumer cancels
  })

  return new AsyncIteratorClass(
    () => runWithSignal(signal, () => iterator.next()),
    async ({ kind }) => {
      if (kind === 'cancelled') {
        cancel()
        await cancelling
      }

      unlisten()
    },
  )
}

function syncReadableStream(stream: ReadableStream<unknown>, signal: AbortSignal, cancel: () => void) {
  const reader = stream.getReader()
  let cancelling: Promise<void> | undefined
  let unlisten: () => void

  return new ReadableStream({
    start(controller) {
      unlisten = listenAbort(signal, () => {
        controller.error(signal.reason)
        cancelling = reader.cancel(signal.reason)
        cancelling.catch(() => {}) // only awaited when the consumer cancels
      })
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read()

        if (signal.aborted) {
          return
        }

        if (done) {
          unlisten()
          controller.close()
        }
        else {
          controller.enqueue(value)
        }
      }
      catch (error) {
        unlisten()
        throw error
      }
    },
    async cancel() {
      cancel()
      await cancelling
    },
  }, { highWaterMark: 0 })
}
