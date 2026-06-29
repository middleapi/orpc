import type { PublisherOptions, PublisherSubscribeListenerOptions } from '@orpc/publisher'
import type { Promisable, ThrowableError } from '@orpc/shared'
import type { EventMeta } from '@standardserver/core'
import type { RedisClient } from 'bun'
import { RPCSerializer } from '@orpc/client'
import { Publisher } from '@orpc/publisher'
import { once, parseEmptyableJSON, stringifyJSON } from '@orpc/shared'
import { getEventMeta, unwrapEvent, withEventMeta } from '@standardserver/core'

export interface BunRedisPublisherOptions extends PublisherOptions {
  /**
   * Redis subscriber instance.
   * Pub/Sub takes over the connection, so a client with subscriptions
   * cannot execute commands and must use a dedicated connection.
   *
   * @default redis.duplicate() (lazily created on first listen)
   */
  subscriber?: undefined | Promisable<RedisClient>

  /**
   * The prefix to use for Redis keys.
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

export class BunRedisPublisher<T extends Record<string, object>> extends Publisher<T> {
  private subscriber: BunRedisPublisherOptions['subscriber']
  private readonly prefix: Exclude<BunRedisPublisherOptions['prefix'], undefined>
  private readonly serializer: Exclude<BunRedisPublisherOptions['serializer'], undefined>
  private readonly replayEnabled: boolean
  private readonly replaySeconds: number

  /**
   * The exactness of the `XTRIM` command.
   * Used for testing purpose.
   */
  private readonly xTrimExactness: '~' | '=' = '~'

  constructor(
    private readonly redis: RedisClient,
    options: BunRedisPublisherOptions = {},
  ) {
    super(options)

    this.prefix = options.prefix ?? ''
    this.serializer = options.serializer ?? new RPCSerializer()
    this.replayEnabled = options.replay?.enabled ?? false
    this.replaySeconds = options.replay?.seconds ?? 300
    this.subscriber = options.subscriber
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

        const result = await Promise.all([
          this.redis.send('XADD', [redisKey, '*', 'data', stringifyJSON(data)]),
          this.redis.send('XTRIM', [redisKey, 'MINID', this.xTrimExactness, `${now - this.replaySeconds * 1000}-0`]),
          // Use a 2x TTL so events published near the end of the replay window
          // are not expired before the next window updates the key expiration.
          this.redis.expire(redisKey, this.replaySeconds * 2),
        ])

        id = result[0] as string
      }
      else {
        id = await this.redis.send('XADD', [redisKey, '*', 'data', stringifyJSON(data)]) as string
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

    this.subscriber ??= this.redis.duplicate()
    const subscriber = await this.subscriber

    try {
      const subscribePromise = subscriber.subscribe(redisKey, redisListener)

      try {
        if (this.replayEnabled && lastEventId !== undefined) {
          /**
           * [Object: null prototype] {
           *    "redis:9d1536ca-8952-4e35-ae79-d466074f9436:orders": [
           *        [ "1782700569588-0", [ "data", "{\"payload\":{\"json\":{\"order\":3}}}" ] ]
           *    ],
           * }
           */
          const results = await this.redis.send('XREAD', ['STREAMS', redisKey, lastEventId])

          if (results && results[redisKey]) {
            const messages = results[redisKey]

            for (const [id, message] of messages) {
              const rawData = message[1]
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
      await subscriber.unsubscribe(redisKey, redisListener)
      throw error
    }

    return once(async () => {
      await subscriber.unsubscribe(redisKey, redisListener)
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
