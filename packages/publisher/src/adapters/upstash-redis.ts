import type { StandardRPCJsonSerializedMetaItem, StandardRPCJsonSerializerOptions } from '@orpc/client/standard'
import type { Redis } from '@upstash/redis'
import type { PublisherOptions, PublisherSubscribeListenerOptions } from '../publisher'
import { StandardRPCJsonSerializer } from '@orpc/client/standard'
import { getEventMeta, withEventMeta } from '@orpc/standard-server'
import { Publisher } from '../publisher'

type SerializedPayload = { json: object, meta: StandardRPCJsonSerializedMetaItem[], eventMeta: ReturnType<typeof getEventMeta> }

export interface UpstashRedisPublisherOptions extends PublisherOptions, StandardRPCJsonSerializerOptions {
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

export class UpstashRedisPublisher<T extends Record<string, object>> extends Publisher<T> {
  protected readonly prefix: string
  protected readonly serializer: StandardRPCJsonSerializer
  protected readonly retentionSeconds: number
  protected readonly listenersMap = new Map<string, Set<(payload: any) => void>>()
  protected readonly subscriptionsMap = new Map<string, any>() // Upstash subscription objects

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
    let size = 0
    for (const listeners of this.listenersMap) {
      size += listeners[1].size || 1 // empty set should never happen so we treat it as a single event
    }
    return size
  }

  constructor(
    protected readonly redis: Redis,
    { resumeRetentionSeconds, prefix, ...options }: UpstashRedisPublisherOptions = {},
  ) {
    super(options)

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

        const results = await this.redis.multi()
          .xadd(key, '*', { data: serialized })
          .xtrim(key, { strategy: 'MINID', exactness: this.xtrimExactness, threshold: `${now - this.retentionSeconds * 1000}-0` })
          .expire(key, this.retentionSeconds * 2)
          .exec()

        id = results[0]
      }
      else {
        const result = await this.redis.xadd(key, '*', { data: serialized })
        id = result
      }
    }

    await this.redis.publish(key, { ...serialized, id })
  }

  protected override async subscribeListener<K extends keyof T & string>(event: K, originalListener: (payload: T[K]) => void, options?: PublisherSubscribeListenerOptions): Promise<() => Promise<void>> {
    const key = this.prefixKey(event)

    const lastEventId = options?.lastEventId
    let pendingPayloads: T[K][] | undefined = []
    let resumePayloadIds: (string | undefined)[] | undefined = []

    const listener = (payload: T[K]) => {
      if (pendingPayloads) {
        pendingPayloads.push(payload)
        return
      }

      if (resumePayloadIds) {
        const payloadId = getEventMeta(payload)?.id
        for (const resumePayloadId of resumePayloadIds) {
          if (payloadId === resumePayloadId) { // duplicate happen
            return
          }
        }

        resumePayloadIds = undefined
      }

      originalListener(payload)
    }

    // Get or create subscription for this channel
    let subscription = this.subscriptionsMap.get(key) as ReturnType<typeof this.redis.subscribe> | undefined
    if (!subscription) {
      subscription = this.redis.subscribe(key)
      subscription.on('message', (event) => {
        try {
          const listeners = this.listenersMap.get(event.channel)

          if (listeners) {
            const { id, ...rest } = event.message as any
            const payload = this.deserializePayload(id, rest)

            for (const listener of listeners) {
              listener(payload)
            }
          }
        }
        catch {
          // there error can happen when event.message is invalid
          // TODO: log error
        }
      })

      let resolvePromise: (value?: unknown) => void
      let rejectPromise: (error: Error) => void
      const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve
        rejectPromise = reject
      })

      subscription.on('error', (error) => {
        rejectPromise(error)
      })

      subscription.on('subscribe', () => {
        resolvePromise()
      })

      await promise

      this.subscriptionsMap.set(key, subscription) // only set after subscription is ready
    }

    let listeners = this.listenersMap.get(key)
    if (!listeners) {
      this.listenersMap.set(key, listeners = new Set())
    }

    listeners.add(listener)

    void (async () => {
      try {
        if (this.isResumeEnabled && typeof lastEventId === 'string') {
          const results = await this.redis.xread(key, lastEventId)

          if (results && results[0]) {
            const [_, items] = results[0] as any
            const firstPendingId = getEventMeta(pendingPayloads[0])?.id
            for (const [id, fields] of items) {
              if (id === firstPendingId) { // duplicate happen
                break
              }

              const serialized = fields[1]! // field value is at index 1 (index 0 is field name 'data')
              const payload = this.deserializePayload(id, serialized)
              resumePayloadIds.push(id)
              originalListener(payload)
            }
          }
        }
      }
      catch {
        // error can happen when result from xread is invalid
        // TODO: log error
      }
      finally {
        for (const payload of pendingPayloads) {
          originalListener(payload)
        }
        pendingPayloads = undefined
      }
    })()

    return async () => {
      listeners.delete(listener)

      if (listeners.size === 0) {
        this.listenersMap.delete(key) // should execute before async to avoid throw
        const subscription = this.subscriptionsMap.get(key)

        if (subscription) {
          this.subscriptionsMap.delete(key)
          await subscription.unsubscribe()
        }
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
