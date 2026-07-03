import type { ThrowableError } from '@orpc/shared'
import type { EventMeta } from '@standardserver/core'
import type { RedisClientType } from 'redis'
import type { PublisherOptions, PublisherSubscribeListenerOptions } from '../publisher'
import { RPCSerializer } from '@orpc/client'
import { once, parseEmptyableJSON, stringifyJSON } from '@orpc/shared'
import { getEventMeta, unwrapEvent, withEventMeta } from '@standardserver/core'
import { Publisher } from '../publisher'

export interface RedisPublisherOptions extends PublisherOptions {
  /**
   * Redis subscriber instance.
   * Pub/Sub takes over the connection, so a client with subscriptions
   * cannot execute commands and must use a dedicated connection.
   *
   * @default redis.duplicate()
   */
  subscriber?: undefined | RedisClientType<any, any, any, any, any>

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

export class RedisPublisher<T extends Record<string, object>> extends Publisher<T> {
  private readonly subscriber: Exclude<RedisPublisherOptions['subscriber'], undefined>
  private readonly prefix: Exclude<RedisPublisherOptions['prefix'], undefined>
  private readonly serializer: Exclude<RedisPublisherOptions['serializer'], undefined>
  private readonly replayEnabled: boolean
  private readonly replaySeconds: number

  /**
   * The exactness of the `XTRIM` command.
   * Used for testing purpose.
   */
  private readonly xTrimExactness: '~' | '=' = '~'

  constructor(
    private readonly redis: RedisClientType<any, any, any, any, any>,
    options: RedisPublisherOptions = {},
  ) {
    super(options)

    this.prefix = options.prefix ?? ''
    this.serializer = options.serializer ?? new RPCSerializer()
    this.replayEnabled = options.replay?.enabled ?? false
    this.replaySeconds = options.replay?.seconds ?? 300
    this.subscriber = options.subscriber ?? redis.duplicate()
  }

  private readonly firstPublishTimeMap: Map<string, number> = new Map()
  async publish<K extends keyof T & string>(event: K, payload: T[K]): Promise<void> {
    const redisKey = `${this.prefix}${event}`
    const data = this.serializePayload(payload)
    let id: string | undefined

    if (!this.redis.isOpen) {
      await this.redis.connect()
    }

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

        const result = await this.redis.multi()
          .xAdd(redisKey, '*', { data: stringifyJSON(data) })
          .xTrim(redisKey, 'MINID', `${now - this.replaySeconds * 1000}-0`, { strategyModifier: this.xTrimExactness })
          // Use a 2x TTL so events published near the end of the replay window
          // are not expired before the next window updates the key expiration.
          .expire(redisKey, this.replaySeconds * 2)
          .exec()

        id = result[0] as unknown as string
      }
      else {
        id = await this.redis.xAdd(redisKey, '*', { data: stringifyJSON(data) }) as string
      }
    }

    await this.redis.publish(redisKey, stringifyJSON({ data, id }))
  }

  protected async subscribeListener<K extends keyof T & string>(
    event: K,
    originalListener: (payload: T[K]) => void,
    { lastEventId, onError }: PublisherSubscribeListenerOptions = {},
  ): Promise<() => Promise<void>> {
    const redisKey = `${this.prefix}${event}`

    if (!this.subscriber.isOpen) {
      await this.subscriber.connect()
    }

    let pendingPayloads: T[K][] | undefined = []
    const replayedIds = new Set<string>()

    const deduplicatingListener = (payload: T[K]) => {
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

    const redisListener = (message: string) => {
      try {
        const { id, data } = parseEmptyableJSON(message) as any
        const payload = this.deserializePayload(id, data)
        deduplicatingListener(payload as any)
      }
      catch (error) {
        // Can happen if the published message has an unexpected format.
        onError?.(error as ThrowableError)
      }
    }

    try {
      const subscribePromise = this.subscriber.subscribe(redisKey, redisListener)

      try {
        if (this.replayEnabled && lastEventId !== undefined) {
          if (!this.redis.isOpen) {
            await this.redis.connect()
          }

          const results = await this.redis.xRead({ key: redisKey, id: lastEventId })

          if (results && results[0]) {
            const { messages } = results[0]

            for (const { id, message } of messages) {
              const rawData = message.data
              const data = parseEmptyableJSON(rawData as string)
              const payload = this.deserializePayload(id, data as any)
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

      await subscribePromise
    }
    catch (error) {
      await this.subscriber.unsubscribe(redisKey, redisListener)
      throw error
    }

    return once(async () => {
      await this.subscriber.unsubscribe(redisKey, redisListener)
    })
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
