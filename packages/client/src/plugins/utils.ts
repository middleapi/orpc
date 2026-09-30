import type { StandardBody, StandardLazyResponse } from '@standard-server/core'
import { AsyncIteratorClass, clone, isAsyncIteratorObject, replicateAsyncIterator, replicateReadableStream, runWithSignal } from '@orpc/shared'
import { ErrorEvent } from '@standard-server/core'
import { wrapAsyncIteratorPreservingEventMeta } from '../async-iterator-object'

/**
 * Replicates a lazy response for callers that share one request, one replica per caller signal.
 *
 * - The body is resolved once, and each replica gets its own copy, so callers never share mutable output.
 * - Each replica honors its own signal: once it aborts, resolving the body or reading the replicated
 *   stream or iterator rejects with `signal.reason`, and that caller's share of the body is released
 *   without affecting the others.
 */
export function replicateLazyResponse(
  response: StandardLazyResponse,
  signals: readonly (AbortSignal | undefined)[],
): StandardLazyResponse[] {
  let replicatedBodies: Promise<StandardBody[]> | undefined

  return signals.map((signal, index) => ({
    ...response,
    resolveBody: hint => runWithSignal(signal, async () => {
      replicatedBodies ??= response.resolveBody(hint).then(body => replicateBody(body, signals))
      const bodies = await replicatedBodies
      return bodies[index]
    }),
  }))
}

function replicateBody(body: StandardBody, signals: readonly (AbortSignal | undefined)[]): StandardBody[] {
  if (isAsyncIteratorObject(body)) {
    // Replicas are read at different paces, so each copies the untouched source events as it reads them.
    return replicateAsyncIterator(body, signals.length)
      .map((replica, index) => abortableAsyncIterator(cloneEvents(replica), signals[index]))
  }

  if (body instanceof ReadableStream) {
    return replicateReadableStream(body, signals.length)
      .map((replica, index) => abortableReadableStream(replica, signals[index]))
  }

  // Every copy is made before any caller can touch the body, so the first caller can keep the original.
  return signals.map((_, index) => index === 0 ? body : cloneBody(body))
}

/**
 * Copies arrays, plain objects, FormData, and URLSearchParams. Other values are kept as is:
 * Blob and File are immutable, and serializers create values like Date or BigInt anew for each caller.
 */
function cloneBody(body: StandardBody): StandardBody {
  if (body instanceof FormData) {
    const form = new FormData()

    for (const [key, value] of body) {
      form.append(key, value)
    }

    return form
  }

  if (body instanceof URLSearchParams) {
    return new URLSearchParams(body)
  }

  return clone(body)
}

function cloneEvents<T, TReturn>(iterator: AsyncIterator<T, TReturn>): AsyncIteratorClass<T, TReturn> {
  return wrapAsyncIteratorPreservingEventMeta(iterator, {
    mapResult: ({ done, value }) => ({ done, value: clone(value) }) as IteratorResult<T, TReturn>,
    mapError: (error) => {
      if (!(error instanceof ErrorEvent)) {
        return error
      }

      const cloned = new ErrorEvent(clone(error.data), { message: error.message, cause: error.cause })
      cloned.stack = error.stack
      return cloned
    },
  })
}

/**
 * Once `signal` aborts, pending and later reads reject with `signal.reason`, and the replica is
 * cancelled right away, even when nobody is reading it, so it no longer holds the shared source open.
 */
function abortableAsyncIterator<T, TReturn>(
  iterator: AsyncIteratorClass<T, TReturn>,
  signal: AbortSignal | undefined,
): AsyncIterator<T, TReturn> {
  if (!signal) {
    return iterator
  }

  const cancel = () => {
    iterator.return().catch(() => {})
  }

  if (signal.aborted) {
    cancel()
  }
  else {
    signal.addEventListener('abort', cancel, { once: true })
  }

  return new AsyncIteratorClass<T, TReturn>(
    () => runWithSignal(signal, () => iterator.next()),
    async () => {
      signal.removeEventListener('abort', cancel)
      await iterator.return()
    },
  )
}

/**
 * Same as {@link abortableAsyncIterator}, for readable streams.
 */
function abortableReadableStream<T>(
  stream: ReadableStream<T>,
  signal: AbortSignal | undefined,
): ReadableStream<T> {
  if (!signal) {
    return stream
  }

  const reader = stream.getReader()
  let abort: () => void
  const stopListening = () => signal.removeEventListener('abort', abort)

  // `highWaterMark: 0` pulls only when the caller reads, like the replica itself.
  return new ReadableStream<T>({
    start(controller) {
      abort = () => {
        controller.error(signal.reason)
        reader.cancel(signal.reason).catch(() => {})
      }

      if (signal.aborted) {
        abort()
      }
      else {
        signal.addEventListener('abort', abort, { once: true })
      }
    },
    async pull(controller) {
      try {
        const result = await reader.read()

        // Aborting already errored this stream.
        if (signal.aborted) {
          return
        }

        if (result.done) {
          stopListening()
          controller.close()
        }
        else {
          controller.enqueue(result.value)
        }
      }
      catch (error) {
        stopListening()
        controller.error(error)
      }
    },
    async cancel(reason) {
      stopListening()
      await reader.cancel(reason)
    },
  }, { highWaterMark: 0 })
}
