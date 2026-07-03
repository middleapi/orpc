import type { ThrowableError } from '@orpc/shared'
import type { EventMeta } from '@standardserver/core'
import type { Redis } from '@upstash/redis'
import type { PublisherOptions, PublisherSubscribeListenerOptions } from '../publisher'
import { RPCSerializer } from '@orpc/client'
import { once } from '@orpc/shared'
import { getEventMeta, unwrapEvent, withEventMeta } from '@standardserver/core'
import { Publisher } from '../publisher'

export interface UpstashPublisherOptions extends PublisherOptions {
  /**
   * The prefix to use for Redis keys.
   *
   * @default ''
   */
  prefix?: string

  /**
   * Serializer for serialize and deserialize payloads.
   *
   * @default RPCSerializer
   */
  serializer?: undefined | Pick<RPCSerializer, keyof RPCSerializer>

  /**
   * Configuration for event replay support.
   *
   * When enabled, published events are temporarily stored so new
   * subscribers can resume from a previous position using `lastEventId`.
   *
   * @default { enabled: false }
   */
  replay?: {
    /**
     * Whether event replay support is enabled.
     *
     * When enabled, published events are temporarily stored so new
     * subscribers can resume from a previous position using `lastEventId`.
     *
     * @default false
     */
    enabled: boolean

    /**
     * How long (in seconds) to retain events for replay.
     *
     * Expired events are cleaned up lazily for performance reasons, so
     * some events may remain available slightly longer than this period.
     *
     * @default 300 (5 min)
     */
    seconds?: number
  }
}

export class UpstashPublisher<T extends Record<string, object>> extends Publisher<T> {
  private readonly prefix: string
  private readonly serializer: Pick<RPCSerializer, keyof RPCSerializer>
  private readonly listenersMap = new Map<keyof T, Array<(payload: any) => void>>()
  private readonly onErrorsMap = new Map<keyof T, Array<(error: ThrowableError) => void>>()
  private readonly subscriptionMap = new Map<keyof T, ReturnType<typeof this.redis.subscribe>>() // Upstash subscription objects
  private readonly replayEnabled: boolean
  private readonly replaySeconds: number

  /**
   * The exactness of the `XTRIM` command.
   * Used for testing purpose.
   */
  private readonly xTrimExactness: '~' | '=' = '~'

  constructor(
    private readonly redis: Redis,
    { replay, prefix, serializer, ...options }: UpstashPublisherOptions = {},
  ) {
    super(options)
    this.prefix = prefix ?? ''
    this.replayEnabled = replay?.enabled ?? false
    this.replaySeconds = replay?.seconds ?? 300
    this.serializer = serializer ?? new RPCSerializer()
  }

  private readonly firstPublishTimeMap: Map<string, number> = new Map()
  async publish<K extends keyof T & string>(event: K, payload: T[K]): Promise<void> {
    const redisKey = `${this.prefix}${event}`
    const data = this.serializePayload(payload)
    let id: string | undefined

    if (this.replayEnabled) {
      const now = Date.now()

      // Remove expired replay windows.
      // The next publish for a stale event will perform trimming again.
      for (const [event, firstPublishTime] of this.firstPublishTimeMap) {
        if (firstPublishTime + this.replaySeconds * 1000 < now) {
          this.firstPublishTimeMap.delete(event)
        }
      }

      if (!this.firstPublishTimeMap.has(event)) {
        this.firstPublishTimeMap.set(event, now)

        const results = await this.redis.multi()
          .xadd(redisKey, '*', { data })
          .xtrim(redisKey, { strategy: 'MINID', exactness: this.xTrimExactness, threshold: `${now - this.replaySeconds * 1000}-0` })
          // Use a 2x TTL so events published near the end of the replay window
          // are not expired before the next window updates the key expiration.
          .expire(redisKey, this.replaySeconds * 2)
          .exec()

        id = results[0]
      }
      else {
        id = await this.redis.xadd(redisKey, '*', { data })
      }
    }

    await this.redis.publish(redisKey, { id, data })
  }

  protected async subscribeListener<K extends keyof T & string>(
    event: K,
    originalListener: (payload: T[K]) => void,
    { lastEventId, onError }: PublisherSubscribeListenerOptions = {},
  ): Promise<() => Promise<void>> {
    const redisKey = `${this.prefix}${event}`

    let pendingPayloads: T[K][] | undefined = []
    const replayedIds = new Set<string>()

    const deduplicatingListener = (payload: T[K]) => {
      // queue payload while replaying events
      if (pendingPayloads) {
        pendingPayloads.push(payload)
        return
      }

      const id = getEventMeta(payload)?.id
      if (id !== undefined && replayedIds.has(id)) { // Already delivered through replay.
        return
      }

      originalListener(payload)
    }

    // Register locally before subscribing to Redis.
    // Messages may arrive while the subscription is being established.
    // and prevent unsubscribe while existing listener for event
    let listeners = this.listenersMap.get(event)
    if (!listeners) {
      this.listenersMap.set(event, listeners = [])
    }
    listeners.push(deduplicatingListener)

    try {
      const subscribeEventPromise = this.subscribeEvent(event)

      try {
        if (this.replayEnabled && lastEventId !== undefined) {
          const results = await this.redis.xread(redisKey, lastEventId)
          if (results && results[0]) {
            const [_, items] = results[0] as any

            for (const [id, fields] of items) {
              const data = fields[1]! // [key: 'data', value, ...]
              const payload = this.deserializePayload(id, data)
              replayedIds.add(id)
              originalListener(payload as T[K])
            }
          }
        }
      }
      finally {
        const pending = pendingPayloads
        pendingPayloads = undefined

        for (const payload of pending) {
          deduplicatingListener(payload)
        }
      }

      await subscribeEventPromise
    }
    catch (error) {
      listeners.splice(listeners.indexOf(deduplicatingListener), 1)
      if (listeners.length === 0) {
        this.listenersMap.delete(event)
      }

      await this.unsubscribeEvent(event)
      throw error
    }

    // Register error listeners only after subscription and replay succeeds.
    // Subscription or replay failures are reported directly via the rejected promise.
    if (onError) {
      let onErrors = this.onErrorsMap.get(event)
      if (!onErrors) {
        this.onErrorsMap.set(event, onErrors = [])
      }
      onErrors.push(onError)
    }

    // once allows unsub safely execute multiple times
    return once(async () => {
      listeners.splice(listeners.indexOf(deduplicatingListener), 1)

      if (onError) {
        const onErrors = this.onErrorsMap.get(event)
        if (onErrors) {
          onErrors.splice(onErrors.indexOf(onError), 1)
        }
      }

      // no need to check onErrors here, it always has lower length than listeners
      if (listeners.length === 0) {
        this.listenersMap.delete(event)
        this.onErrorsMap.delete(event)
      }

      await this.unsubscribeEvent(event)
    })
  }

  private readonly pendingSubscriptionsMap = new Map<keyof T, Promise<void>>()
  private async subscribeEvent(event: keyof T & string): Promise<void> {
    const redisKey = `${this.prefix}${event}`

    // Another caller is currently establishing the subscription.
    // Wait for it to finish before checking whether a new subscription is still needed.
    const pending = this.pendingSubscriptionsMap.get(event)
    if (pending) {
      try {
        await pending
      }
      catch {
        // The previous subscription attempt failed.
        // Continue and attempt to establish a new subscription.
      }
    }

    if (this.subscriptionMap.has(event)) {
      return
    }

    const dispatchErrorForEvent = (error: ThrowableError) => {
      const onErrors = this.onErrorsMap.get(event)
      onErrors?.forEach(onError => onError(error))
    }

    const subscription = this.redis.subscribe(redisKey)
    subscription.on('message', (message) => {
      try {
        const listeners = this.listenersMap.get(event)

        if (listeners) {
          const { id, data } = message.message as any
          const payload = this.deserializePayload(id, data)
          listeners.forEach(listener => listener(payload))
        }
      }
      catch (error) {
        // Can happen if the published message has an unexpected format.
        dispatchErrorForEvent(error as ThrowableError)
      }
    })

    let resolvePromise: () => void
    let rejectPromise: (error: Error) => void
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })

    subscription.on('error', (error) => {
      rejectPromise(error)
      dispatchErrorForEvent(error)
    })

    subscription.on('subscribe', () => {
      resolvePromise()
    })

    try {
      this.pendingSubscriptionsMap.set(event, promise)
      await promise
      this.subscriptionMap.set(event, subscription) // set after subscription is ready
    }
    finally {
      this.pendingSubscriptionsMap.delete(event)
    }
  }

  private async unsubscribeEvent(event: keyof T & string): Promise<void> {
    // Another caller is currently establishing the subscription.
    // Wait for it to finish before checking whether a subscription is existed.
    const pending = this.pendingSubscriptionsMap.get(event)
    if (pending) {
      try {
        await pending
      }
      catch {}
    }

    const subscription = this.subscriptionMap.get(event)

    // no need to check onErrors here, it always has lower length than listeners
    if (!this.listenersMap.has(event) && subscription) {
      // Remove before awaiting to prevent race conditions.
      this.subscriptionMap.delete(event)
      await subscription.unsubscribe()
    }
  }

  private serializePayload(payload: object): { payload: unknown, meta?: undefined | EventMeta } {
    const [original, meta] = unwrapEvent(payload)
    return { payload: this.serializer.serialize(original, { useFormDataForBlobFields: false }), meta }
  }

  private deserializePayload(id: string | undefined, { payload, meta }: { payload: unknown, meta?: undefined | EventMeta }): object {
    return withEventMeta(
      this.serializer.deserialize(payload) as object,
      id === undefined ? { ...meta } : { ...meta, id },
    )
  }
}
