import type { StandardRPCJsonSerializedMetaItem, StandardRPCJsonSerializerOptions } from '@orpc/client/standard'
import type Redis from 'ioredis'
import type { PublisherOptions, PublisherSubscribeListenerOptions } from '../publisher'
import { StandardRPCJsonSerializer } from '@orpc/client/standard'
import { fallback, stringifyJSON } from '@orpc/shared'
import { getEventMeta, withEventMeta } from '@orpc/standard-server'
import { Publisher } from '../publisher'

type SerializedPayload = { json: object, meta: StandardRPCJsonSerializedMetaItem[], eventMeta: ReturnType<typeof getEventMeta> }

export interface IORedisPublisherOptions extends PublisherOptions, StandardRPCJsonSerializerOptions {
  /**
   * Redis commander instance (used for execute short-lived commands)
   */
  commander: Redis

  /**
   * redis listener instance (used for listening to events)
   *
   * @remark
   * - `lazyConnect: true` option is supported
   */
  listener: Redis

  /**
   * How long (in seconds) to retain events for replay.
   *
   * @remark
   * This allows new subscribers to "catch up" on missed events using `lastEventId`.
   * Note that event cleanup is deferred for performance reasons — meaning some
   * expired events may still be available for a short period of time, and listeners
   * might still receive them.
   *
   * @default NaN (disabled)
   */
  resumeRetentionSeconds?: number

  /**
   * The prefix to use for Redis keys.
   *
   * @default orpc:publisher:
   */
  prefix?: string
}

export class IORedisPublisher<T extends Record<string, object>> extends Publisher<T> {
  protected readonly commander: Redis
  protected readonly listener: Redis

  protected readonly prefix: string
  protected readonly serializer: StandardRPCJsonSerializer
  protected readonly retentionSeconds: number
  protected readonly listenerPromiseMap = new Map<string, Promise<any>>()
  protected readonly listenersMap = new Map<string, Set<(payload: any) => void>>()
  protected redisListener: ((channel: string, message: string) => void) | undefined

  protected get isResumeEnabled(): boolean {
    return Number.isFinite(this.retentionSeconds) && this.retentionSeconds > 0
  }

  /**
   * The exactness of the `XTRIM` command.
   *
   * @internal
   */
  xtrimExactness: '~' | '=' = '~'

  /**
   * Useful for measuring memory usage.
   *
   * @internal
   *
   */
  get size(): number {
    /* v8 ignore next 5 */
    let size = this.redisListener ? 1 : 0
    for (const listeners of this.listenersMap) {
      size += listeners[1].size || 1 // empty set should never happen so we treat it as a single event
    }
    return size
  }

  constructor(
    { commander, listener, resumeRetentionSeconds, prefix, ...options }: IORedisPublisherOptions,
  ) {
    super(options)

    this.commander = commander
    this.listener = listener
    this.prefix = fallback(prefix, 'orpc:publisher:') // use fallback to improve test-coverage
    this.retentionSeconds = resumeRetentionSeconds ?? Number.NaN
    this.serializer = new StandardRPCJsonSerializer(options)
  }

  protected lastCleanupTimes: Map<string, number> = new Map()
  override async publish<K extends keyof T & string>(event: K, payload: T[K]): Promise<void> {
    const key = this.prefixKey(event)

    const serialized = this.serializePayload(payload)

    let id: string | undefined
    if (this.isResumeEnabled) {
      const now = Date.now()

      // cleanup for more efficiency memory
      for (const [key, lastCleanupTime] of this.lastCleanupTimes) {
        if (lastCleanupTime + this.retentionSeconds * 1000 < now) {
          this.lastCleanupTimes.delete(key)
        }
      }

      if (!this.lastCleanupTimes.has(key)) {
        this.lastCleanupTimes.set(key, now)

        const result = await this.commander.multi()
          .xadd(key, '*', 'data', stringifyJSON(serialized))
          .xtrim(key, 'MINID', this.xtrimExactness as '~', `${now - this.retentionSeconds * 1000}-0`)
          .expire(key, this.retentionSeconds * 2) // double to avoid expires new events
          .exec()

        if (result) {
          for (const [error] of result) {
            if (error) {
              throw error
            }
          }
        }

        id = (result![0]![1] as string)
      }
      else {
        const result = await this.commander.xadd(key, '*', 'data', stringifyJSON(serialized))
        id = result!
      }
    }

    await this.commander.publish(key, stringifyJSON({ ...serialized, id }))
  }

  protected override async subscribeListener<K extends keyof T & string>(event: K, originalListener: (payload: T[K]) => void, options?: PublisherSubscribeListenerOptions): Promise<() => Promise<void>> {
    const key = this.prefixKey(event)

    const lastEventId = options?.lastEventId
    let pendingPayloads: T[K][] | undefined = []
    const resumePayloadIds = new Set<string>()

    const listener = (payload: T[K]) => {
      if (pendingPayloads) {
        pendingPayloads.push(payload)
        return
      }

      const payloadId = getEventMeta(payload)?.id
      if (
        payloadId !== undefined // if resume is enabled payloadId will be defined
        && resumePayloadIds.has(payloadId) // duplicate happen
      ) {
        return
      }

      originalListener(payload)
    }

    if (!this.redisListener) {
      this.redisListener = (channel: string, message: string) => {
        try {
          const listeners = this.listenersMap.get(channel)

          if (listeners) {
            const { id, ...rest } = JSON.parse(message)
            const payload = this.deserializePayload(id, rest)

            for (const listener of listeners) {
              listener(payload)
            }
          }
        }
        catch {
          // error can happen when message is invalid
          // TODO: log error
        }
      }

      this.listener.on('message', this.redisListener)
    }

    // avoid race condition when multiple listeners subscribe to the same channel on first time
    await this.listenerPromiseMap.get(key)

    let listeners = this.listenersMap.get(key)
    if (!listeners) {
      try {
        const promise = this.listener.subscribe(key)
        this.listenerPromiseMap.set(key, promise)
        await promise
        this.listenersMap.set(key, listeners = new Set()) // only set after subscribe successfully
      }
      finally {
        this.listenerPromiseMap.delete(key)
      }
    }

    listeners.add(listener)

    void (async () => {
      try {
        if (this.isResumeEnabled && typeof lastEventId === 'string') {
          const results = await this.commander.xread('STREAMS', key, lastEventId)

          if (results && results[0]) {
            const [_, items] = results[0]

            for (const [id, fields] of items) {
              const serialized = fields[1]! // field value is at index 1 (index 0 is field name 'data')
              const payload = this.deserializePayload(id, JSON.parse(serialized))
              resumePayloadIds.add(id)
              originalListener(payload)
            }
          }
        }
      }
      catch {
        // error happen when message is invalid
        // TODO: log error
      }
      finally {
        const pending = pendingPayloads
        pendingPayloads = undefined

        for (const payload of pending) {
          listener(payload) // listener instead of originalListener for deduplication
        }
      }
    })()

    return async () => {
      listeners.delete(listener)
      if (listeners.size === 0) {
        this.listenersMap.delete(key) // should execute before async to avoid throw

        if (this.redisListener && this.listenersMap.size === 0) {
          this.listener.off('message', this.redisListener)
          this.redisListener = undefined
        }

        await this.listener.unsubscribe(key)
      }
    }
  }

  protected prefixKey(key: string): string {
    return `${this.prefix}${key}`
  }

  protected serializePayload(payload: object): SerializedPayload {
    const eventMeta = getEventMeta(payload)
    const [json, meta] = this.serializer.serialize(payload)
    return { json: json as object, meta, eventMeta }
  }

  protected deserializePayload(id: string | undefined, { json, meta, eventMeta }: SerializedPayload): any {
    return withEventMeta(
      this.serializer.deserialize(json, meta) as object,
      id === undefined ? { ...eventMeta } : { ...eventMeta, id },
    )
  }
}
