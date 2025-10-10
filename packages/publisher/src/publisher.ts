import { AsyncIteratorClass } from '@orpc/shared'

export interface PublisherOptions {
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

export interface PublisherSubscribeListenerOptions {
  /**
   * Resume from a specific event ID
   */
  lastEventId?: string | undefined
}

export interface PublisherSubscribeIteratorOptions extends PublisherSubscribeListenerOptions, PublisherOptions {
  /**
   * Abort signal, automatically unsubscribes on abort
   */
  signal?: AbortSignal | undefined | null
}

export abstract class Publisher<T extends Record<string, object>> {
  private readonly maxBufferedEvents: Exclude<PublisherOptions['maxBufferedEvents'], undefined>

  constructor(
    options: PublisherOptions = {},
  ) {
    this.maxBufferedEvents = options.maxBufferedEvents ?? 100
  }

  /**
   * Publish an event to subscribers
   */
  abstract publish<K extends keyof T>(event: K, payload: T[K]): Promise<void>

  /**
   * Subscribes to a specific event using a callback function.
   * Returns an unsubscribe function to remove the listener.
   *
   * @remarks
   * This method should be protected to avoid conflicts with `subscribe` method
   */
  protected abstract subscribeListener<K extends keyof T>(
    event: K,
    listener: (payload: T[K]) => void,
    options?: PublisherSubscribeListenerOptions
  ): Promise<() => Promise<void>>

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
  subscribe<K extends keyof T>(event: K, listener: (payload: T[K]) => void, options?: PublisherSubscribeListenerOptions): Promise<() => Promise<void>>
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
  subscribe<K extends keyof T>(event: K, options?: PublisherSubscribeIteratorOptions): AsyncIteratorClass<T[K], void, void>
  subscribe<K extends keyof T>(
    event: K,
    listenerOrOptions?: ((payload: T[K]) => void) | PublisherSubscribeIteratorOptions,
    listenerOptions?: PublisherSubscribeListenerOptions,
  ): Promise<() => Promise<void>> | AsyncIteratorClass<T[K], void, void> {
    if (typeof listenerOrOptions === 'function') {
      return this.subscribeListener(event, listenerOrOptions, listenerOptions)
    }

    const signal = listenerOrOptions?.signal
    const maxBufferedEvents = listenerOrOptions?.maxBufferedEvents ?? this.maxBufferedEvents

    signal?.throwIfAborted()

    const bufferedEvents: T[K][] = []
    const pullResolvers: [(result: IteratorResult<T[K]>) => void, (error: Error) => void][] = []

    const unsubscribePromise = this.subscribe(event, (payload) => {
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
      pullResolvers.forEach(resolver => resolver[1](event.target.reason))
      pullResolvers.length = 0
      bufferedEvents.length = 0
      unsubscribePromise.then(unsubscribe => unsubscribe()).catch(() => {}) // ignore error
    }

    signal?.addEventListener('abort', abortListener, { once: true })

    return new AsyncIteratorClass(async () => {
      await unsubscribePromise // make sure subscription is ready

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
      signal?.removeEventListener('abort', abortListener)
      pullResolvers.forEach(resolver => resolver[0]({ done: true, value: undefined }))
      pullResolvers.length = 0
      bufferedEvents.length = 0

      await unsubscribePromise.then(unsubscribe => unsubscribe())
    })
  }
}
