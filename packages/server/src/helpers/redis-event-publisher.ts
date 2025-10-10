import type { StandardRPCJsonSerializerOptions } from '@orpc/client/standard'
import { StandardRPCJsonSerializer } from '@orpc/client/standard'
import { AsyncIteratorClass, stringifyJSON } from '@orpc/shared'

/**
 * Redis client interface that supports the required operations for event publishing.
 * Most Redis clients (ioredis, node-redis, upstash) follow this pattern.
 */
export interface RedisClient {
  publish(channel: string, message: string): Promise<number>
  subscribe(channel: string, callback: (message: string) => void): Promise<void>
  unsubscribe(channel: string): Promise<void>
  quit(): Promise<void>
}

/**
 * Options for Redis Event Publisher
 */
export interface RedisEventPublisherOptions extends StandardRPCJsonSerializerOptions {
  /**
   * Redis client instance. Must implement the RedisClient interface.
   */
  redis: RedisClient

  /**
   * Key prefix for Redis channels. Defaults to 'orpc:event:'
   */
  keyPrefix?: string

  /**
   * Maximum number of events to buffer for async iterator subscribers.
   * @default 100
   */
  maxBufferedEvents?: number
}

/**
 * Default key prefix for Redis channels
 */
const DEFAULT_KEY_PREFIX = 'orpc:event:'

/**
 * Default maximum number of events to buffer for async iterator subscribers
 */
const DEFAULT_MAX_BUFFERED_EVENTS = 100

/**
 * Redis-based Event Publisher for cross-server and serverless use cases.
 *
 * This implementation uses Redis Pub/Sub to enable event publishing and subscription
 * across multiple server instances, making it suitable for distributed applications
 * and serverless environments.
 *
 * @example
 * ```ts
 * import { RedisEventPublisher } from '@orpc/server/helpers'
 * import { createClient } from 'redis'
 *
 * const redis = createClient({ url: 'redis://localhost:6379' })
 * await redis.connect()
 *
 * const publisher = new RedisEventPublisher<{
 *   'user-updated': { id: string; name: string }
 * }>({ redis })
 *
 * // Publish an event
 * await publisher.publish('user-updated', { id: '1', name: 'John' })
 *
 * // Subscribe to events
 * for await (const payload of publisher.subscribe('user-updated', { signal })) {
 *   console.log('User updated:', payload)
 * }
 * ```
 */
export class RedisEventPublisher<T extends Record<PropertyKey, any>> {
  #redis: RedisClient
  #keyPrefix: string
  #maxBufferedEvents: number
  #serializer: StandardRPCJsonSerializer
  #subscribedChannels = new Set<keyof T>()
  #callbacks = new Map<keyof T, Set<(payload: any) => void>>()

  constructor(options: RedisEventPublisherOptions) {
    this.#redis = options.redis
    this.#keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX
    this.#maxBufferedEvents = options.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS
    this.#serializer = new StandardRPCJsonSerializer(options)
  }

  get size(): number {
    return Array.from(this.#callbacks.values()).reduce((total, callbacks) => total + callbacks.size, 0)
  }

  /**
   * Emits an event and delivers the payload to all subscribed listeners.
   * The event is published to Redis and will be received by all instances.
   */
  async publish<K extends keyof T>(event: K, payload: T[K]): Promise<void> {
    const channel = this.#getChannelName(event)
    const [json, meta] = this.#serializer.serialize(payload)
    const message = stringifyJSON({ json, meta }) ?? ''

    await this.#redis.publish(channel, message)
  }

  /**
   * Subscribes to a specific event using a callback function.
   * Returns an unsubscribe function to remove the listener.
   *
   * @example
   * ```ts
   * const unsubscribe = await publisher.subscribe('event', (payload) => {
   *   console.log(payload)
   * })
   *
   * // Later
   * await unsubscribe()
   * ```
   */
  subscribe<K extends keyof T>(event: K, listener: (payload: T[K]) => void): Promise<() => Promise<void>>
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
  subscribe<K extends keyof T>(event: K, options?: { signal?: AbortSignal, maxBufferedEvents?: number }): AsyncGenerator<T[K]> & AsyncIteratorObject<T[K]>
  subscribe<K extends keyof T>(
    event: K,
    listenerOrOptions?: ((payload: T[K]) => void) | { signal?: AbortSignal, maxBufferedEvents?: number },
  ): Promise<() => Promise<void>> | (AsyncGenerator<T[K]> & AsyncIteratorObject<T[K]>) {
    if (typeof listenerOrOptions === 'function') {
      return this.#subscribeWithCallback(event, listenerOrOptions)
    }

    return this.#subscribeWithIterator(event, listenerOrOptions)
  }

  async #subscribeWithCallback<K extends keyof T>(
    event: K,
    listener: (payload: T[K]) => void,
  ): Promise<() => Promise<void>> {
    // Add callback to the set for this event
    if (!this.#callbacks.has(event)) {
      this.#callbacks.set(event, new Set())
    }
    this.#callbacks.get(event)!.add(listener)

    // Subscribe to Redis channel if not already subscribed
    if (!this.#subscribedChannels.has(event)) {
      const redisCallback = async (message: string) => {
        const { json, meta } = JSON.parse(message)
        const payload = this.#serializer.deserialize(json, meta)

        // Call all registered callbacks for this event
        const callbacks = this.#callbacks.get(event)
        if (callbacks) {
          for (const callback of callbacks) {
            callback(payload)
          }
        }
      }

      await this.#redis.subscribe(this.#getChannelName(event), redisCallback)
      this.#subscribedChannels.add(event)
    }

    return async () => {
      // Remove this specific callback
      const callbacks = this.#callbacks.get(event)
      if (callbacks) {
        callbacks.delete(listener)

        // If no more callbacks, unsubscribe from Redis channel
        if (callbacks.size === 0) {
          await this.#redis.unsubscribe(this.#getChannelName(event))
          this.#subscribedChannels.delete(event)
          this.#callbacks.delete(event)
        }
      }
    }
  }

  #subscribeWithIterator<K extends keyof T>(
    event: K,
    options?: { signal?: AbortSignal, maxBufferedEvents?: number },
  ): AsyncGenerator<T[K]> & AsyncIteratorObject<T[K]> {
    const signal = options?.signal
    const maxBufferedEvents = options?.maxBufferedEvents ?? this.#maxBufferedEvents

    signal?.throwIfAborted()

    const bufferedEvents: T[K][] = []
    const pullResolvers: [(result: IteratorResult<T[K]>) => void, (error: Error) => void][] = []

    let unsubscribe: (() => Promise<void>) | null = null

    const listener = (payload: T[K]) => {
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
    }

    // Subscribe asynchronously
    const subscribePromise = this.#subscribeWithCallback(event, listener).then((unsub) => {
      unsubscribe = unsub
    })

    const abortListener = async (event: any) => {
      // Wait for unsubscribe to be set if it's not set yet
      if (!unsubscribe) {
        await subscribePromise
      }

      if (unsubscribe) {
        await unsubscribe()
      }

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
      if (unsubscribe) {
        await unsubscribe()
      }
      signal?.removeEventListener('abort', abortListener)
      pullResolvers.forEach(resolver => resolver[0]({ done: true, value: undefined }))
      pullResolvers.length = 0
      bufferedEvents.length = 0
    })
  }

  #getChannelName(event: keyof T): string {
    return `${this.#keyPrefix}${String(event)}`
  }

  /**
   * Close the Redis connection and clean up resources.
   */
  async close(): Promise<void> {
    // Unsubscribe from all Redis channels
    for (const event of this.#subscribedChannels) {
      await this.#redis.unsubscribe(this.#getChannelName(event))
    }
    this.#subscribedChannels.clear()
    this.#callbacks.clear()

    // Close Redis connection
    await this.#redis.quit()
  }
}
