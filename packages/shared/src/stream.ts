import { AsyncIteratorClass } from './iterator'
import { isObject } from './object'

/**
 * Converts a `ReadableStream` into an `AsyncIteratorClass`.
 */
export function streamToAsyncIteratorClass<T>(
  stream: ReadableStream<T>,
): AsyncIteratorClass<T> {
  const reader = stream.getReader()

  return new AsyncIteratorClass<T>(
    async () => {
      return reader.read() as Promise<IteratorResult<T>>
    },
    async () => {
      await reader.cancel()
    },
  )
}

/**
 * Converts an `AsyncIterator` into a `ReadableStream`.
 */
export function asyncIteratorToStream<T>(
  iterator: AsyncIterator<T>,
): ReadableStream<T> {
  return new ReadableStream<T>({
    async pull(controller) {
      const { done, value } = await iterator.next()

      if (done) {
        controller.close()
      }
      else {
        controller.enqueue(value)
      }
    },
    async cancel() {
      await iterator.return?.()
    },
  })
}

/**
 * Converts an `AsyncIterator` into a `ReadableStream`, ensuring that
 * all emitted object values are *unproxied* before enqueuing.
 */
export function asyncIteratorToUnproxiedDataStream<T>(
  iterator: AsyncIterator<T>,
): ReadableStream<T> {
  return new ReadableStream<T>({
    async pull(controller) {
      const { done, value } = await iterator.next()

      if (done) {
        controller.close()
      }
      else {
        const unproxied = isObject(value)
          ? { ...value }
          : Array.isArray(value)
            ? value.map(i => i) as T // use .map instead of ... to deal with sparse arrays
            : value

        controller.enqueue(unproxied)
      }
    },
    async cancel() {
      await iterator.return?.()
    },
  })
}
