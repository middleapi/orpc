import type { StandardRPCJsonSerializedMetaItem, StandardRPCJsonSerializerOptions } from '@orpc/client/standard'
import type Redis from 'ioredis'
import type { PublisherOptions, PublisherSubscribeListenerOptions } from '../publisher'
import { StandardRPCJsonSerializer } from '@orpc/client/standard'
import { stringifyJSON } from '@orpc/shared'
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
  protected readonly listeners = new Map<string, Set<(payload: any) => void>>()
  protected redisListener: ((channel: string, message: string) => void) | undefined

  protected get isResumeEnabled(): boolean {
    return Number.isFinite(this.retentionSeconds) && this.retentionSeconds > 0
  }

  /**
   * Useful for measuring memory usage.
   *
   * @internal
   *
   */
  get size(): number {
    let size = this.redisListener ? 1 : 0
    for (const listeners of this.listeners) {
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
    this.prefix = prefix ?? 'orpc:publisher:'
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
          .xadd(key, '*', stringifyJSON(serialized))
          .xtrim(key, 'MINID', `${now - this.retentionSeconds * 1000}-0`)
          .expire(key, this.retentionSeconds * 2) // double to avoid expires new events
          .exec()

        if (result) {
          for (const [error] of result) {
            if (error) {
              throw error
            }
          }
        }

        id = (result![0]![1] as string | null) ?? undefined
      }
      else {
        const result = await this.commander.xadd(key, '*', stringifyJSON(serialized))
        id = result ?? undefined
      }
    }

    await this.commander.publish(key, stringifyJSON({ ...serialized, id }))
  }

  protected override async subscribeListener<K extends keyof T & string>(event: K, _listener: (payload: T[K]) => void, options?: PublisherSubscribeListenerOptions): Promise<() => Promise<void>> {
    const key = this.prefixKey(event)

    const lastEventId = options?.lastEventId
    let pendingPayloads: T[K][] | undefined = []

    const listener = (payload: T[K]) => {
      if (pendingPayloads) {
        pendingPayloads.push(payload)
      }
      else {
        _listener(payload)
      }
    }

    if (!this.redisListener) {
      this.redisListener = (channel: string, message: string) => {
        const listeners = this.listeners.get(channel)

        if (listeners) {
          const { id, ...rest } = JSON.parse(message)
          const payload = this.deserializePayload(id, rest)

          for (const listener of listeners) {
            listener(payload)
          }
        }
      }

      this.listener.on('message', this.redisListener)
    }

    let listeners = this.listeners.get(key)
    if (!listeners) {
      await this.listener.subscribe(key)
      this.listeners.set(key, listeners = new Set()) // only set after subscribe successfully
    }

    listeners.add(listener)

    void (async () => {
      try {
        if (this.isResumeEnabled && typeof lastEventId === 'string') {
          const results = await this.commander.xread('STREAMS', key, lastEventId)

          if (results && results[0]) {
            const [_, items] = results[0]
            const firstPendingId = getEventMeta(pendingPayloads[0])?.id
            for (const [id, fields] of items) {
              if (id === firstPendingId) {
                break
              }

              const serialized = fields[0]!
              const payload = this.deserializePayload(id, JSON.parse(serialized))
              listener(payload)
            }
          }
        }
      }
      catch {
        // TODO: log error
      }
      finally {
        for (const payload of pendingPayloads) {
          listener(payload)
        }

        pendingPayloads = undefined // disable pending
      }
    })()

    return async () => {
      listeners.delete(listener)
      if (listeners.size === 0) {
        this.listeners.delete(key) // should execute before async to avoid throw

        if (this.redisListener && this.listeners.size === 0) {
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
