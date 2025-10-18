import { once } from './function'
import { AsyncIteratorClass } from './iterator'

export interface EventPublisherOptions {
  /**
   * Maximum number of events to buffer for async iterator subscribers.
   *
   * If the buffer exceeds this limit, the oldest event is dropped.
   * This prevents unbounded memory growth if consumers process events slowly.
   *
   * Set to:
   * - `0`: Disable buffering. Events must be consumed before the next one arrives.
   * - `1`: Only keep the latest event. Useful for real-time updates where only the most recent value matters.
   * - `Infinity`: Keep all events. Ensures no data loss, but may lead to high memory usage.
   *
   * @default 100
   */
  maxBufferedEvents?: number
}

export interface EventPublisherSubscribeIteratorOptions extends EventPublisherOptions {
  /**
   * Aborts the async iterator. Throws if aborted before or during pulling.
   */
  signal?: AbortSignal | undefined
}

export class EventPublisher<T extends Record<PropertyKey, any>> {
  #listenersMap = new Map<keyof T, Array<(payload: any) => void>>()
  #maxBufferedEvents: number

  constructor(options: EventPublisherOptions = {}) {
    this.#maxBufferedEvents = options.maxBufferedEvents ?? 100
  }

  get size(): number {
    return this.#listenersMap.size
  }

  /**
   * Emits an event and delivers the payload to all subscribed listeners.
   */
  publish<K extends keyof T>(event: K, payload: T[K]): void {
    const listeners = this.#listenersMap.get(event)

    if (!listeners) {
      return
    }

    for (const listener of listeners) {
      listener(payload)
    }
  }

  /**
   * Subscribes to a specific event using a callback function.
   * Returns an unsubscribe function to remove the listener.
   *
   * @example
   * ```ts
   * const unsubscribe = publisher.subscribe('event', (payload) => {
   *   console.log(payload)
   * })
   *
   * // Later
   * unsubscribe()
   * ```
   */
  subscribe<K extends keyof T>(event: K, listener: (payload: T[K]) => void): () => void
  /**
   * Subscribes to a specific event using an async iterator.
   * Useful for `for await...of` loops with optional buffering and abort support.
   *
   * @example
   * ```ts
   * for await (const payload of publisher.subscribe('event', { signal })) {
   *   console.log(payload)
   * }
   * ```
   */
  subscribe<K extends keyof T>(event: K, options?: EventPublisherSubscribeIteratorOptions): AsyncGenerator<T[K]> & AsyncIteratorObject<T[K]>
  subscribe<K extends keyof T>(
    event: K,
    listenerOrOptions?: ((payload: T[K]) => void) | EventPublisherSubscribeIteratorOptions,
  ): (() => void) | AsyncGenerator<T[K]> & AsyncIteratorObject<T[K]> {
    if (typeof listenerOrOptions === 'function') {
      let listeners = this.#listenersMap.get(event)

      if (!listeners) {
        this.#listenersMap.set(event, listeners = [])
      }
      listeners.push(listenerOrOptions)

      return once(() => {
        listeners.splice(listeners.indexOf(listenerOrOptions), 1)

        if (listeners.length === 0) {
          this.#listenersMap.delete(event)
        }
      })
    }

    const signal = listenerOrOptions?.signal
    const maxBufferedEvents = listenerOrOptions?.maxBufferedEvents ?? this.#maxBufferedEvents

    signal?.throwIfAborted()

    const bufferedEvents: T[K][] = []
    const pullResolvers: [(result: IteratorResult<T[K]>) => void, (error: Error) => void][] = []

    const unsubscribe = this.subscribe(event, (payload) => {
      const resolver = pullResolvers.shift()

      if (resolver) {
        resolver[0]({ done: false, value: payload })
      }
      else {
        bufferedEvents.push(payload)

        if (bufferedEvents.length > maxBufferedEvents) {
          bufferedEvents.shift()
        }
      }
    })

    const abortListener = (event: any) => {
      unsubscribe()
      pullResolvers.forEach(resolver => resolver[1](event.target.reason))
      pullResolvers.length = 0
      bufferedEvents.length = 0
    }

    signal?.addEventListener('abort', abortListener, { once: true })

    return new AsyncIteratorClass(async () => {
      if (signal?.aborted) {
        throw signal.reason
      }

      if (bufferedEvents.length > 0) {
        return { done: false, value: bufferedEvents.shift()! }
      }

      return new Promise((resolve, reject) => {
        pullResolvers.push([resolve, reject])
      })
    }, async () => {
      unsubscribe()
      signal?.removeEventListener('abort', abortListener)
      pullResolvers.forEach(resolver => resolver[0]({ done: true, value: undefined }))
      pullResolvers.length = 0
      bufferedEvents.length = 0
    })
  }
}
