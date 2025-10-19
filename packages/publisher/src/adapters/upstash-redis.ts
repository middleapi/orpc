import type { StandardRPCJsonSerializedMetaItem, StandardRPCJsonSerializerOptions } from '@orpc/client/standard'
import type { ThrowableError } from '@orpc/shared'
import type { Redis } from '@upstash/redis'
import type { PublisherOptions, PublisherSubscribeListenerOptions } from '../publisher'
import { StandardRPCJsonSerializer } from '@orpc/client/standard'
import { fallback, once } from '@orpc/shared'
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
  protected readonly listenersMap = new Map<string, Array<(payload: any) => void>>()
  protected readonly onErrorsMap = new Map<string, Array<(error: ThrowableError) => void>>()
  protected readonly subscriptionPromiseMap = new Map<string, Promise<void>>()
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
    /* v8 ignore next 8 */
    let size = 0
    for (const listeners of this.listenersMap) {
      size += listeners[1].length || 1 // empty array should never happen so we treat it as a single event
    }
    for (const onErrors of this.onErrorsMap) {
      size += onErrors[1].length || 1 // empty array should never happen so we treat it as a single event
    }
    return size
  }

  constructor(
    protected readonly redis: Redis,
    { resumeRetentionSeconds, prefix, ...options }: UpstashRedisPublisherOptions = {},
  ) {
    super(options)

    this.prefix = fallback(prefix, 'orpc:publisher:') // use fallback to improve test-coverage
    this.retentionSeconds = resumeRetentionSeconds ?? Number.NaN
    this.serializer = new StandardRPCJsonSerializer(options)
  }

  protected lastCleanupTimeMap: Map<string, number> = new Map()
  override async publish<K extends keyof T & string>(event: K, payload: T[K]): Promise<void> {
    const key = this.prefixKey(event)

    const serialized = this.serializePayload(payload)

    let id: string | undefined
    if (this.isResumeEnabled) {
      const now = Date.now()

      // cleanup for more efficiency memory
      for (const [mapKey, lastCleanupTime] of this.lastCleanupTimeMap) {
        if (lastCleanupTime + this.retentionSeconds * 1000 < now) {
          this.lastCleanupTimeMap.delete(mapKey)
        }
      }

      if (!this.lastCleanupTimeMap.has(key)) {
        this.lastCleanupTimeMap.set(key, now)

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

  protected override async subscribeListener<K extends keyof T & string>(
    event: K,
    originalListener: (payload: T[K]) => void,
    { lastEventId, onError }: PublisherSubscribeListenerOptions = {},
  ): Promise<() => Promise<void>> {
    const key = this.prefixKey(event)

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

    const subscriptionPromise = this.subscriptionPromiseMap.get(key)
    if (subscriptionPromise) {
      // Avoid race conditions when multiple listeners subscribe to the same channel at once.
      // Await only if subscriptionPromise exists, and ensure no other `await` occurs between its set and await.
      await subscriptionPromise
    }
    let subscription = this.subscriptionsMap.get(key) as ReturnType<typeof this.redis.subscribe> | undefined
    if (!subscription) {
      const dispatchErrorForKey = (error: ThrowableError) => {
        const onErrors = this.onErrorsMap.get(key)
        if (onErrors) {
          for (const onError of onErrors) {
            onError(error)
          }
        }
      }

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
        catch (error) {
          // there error can happen when event.message is invalid
          dispatchErrorForKey(error as ThrowableError)
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
        dispatchErrorForKey(error)
      })

      subscription.on('subscribe', () => {
        resolvePromise()
      })

      try {
        this.subscriptionPromiseMap.set(key, promise)
        await promise
        this.subscriptionsMap.set(key, subscription) // set after subscription is ready
      }
      finally {
        this.subscriptionPromiseMap.delete(key)
      }
    }

    let listeners = this.listenersMap.get(key)
    if (!listeners) {
      this.listenersMap.set(key, listeners = [])
    }
    listeners.push(listener)

    if (onError) {
      let onErrors = this.onErrorsMap.get(key)
      if (!onErrors) {
        this.onErrorsMap.set(key, onErrors = [])
      }
      onErrors.push(onError)
    }

    void (async () => {
      try {
        if (this.isResumeEnabled && typeof lastEventId === 'string') {
          const results = await this.redis.xread(key, lastEventId)

          if (results && results[0]) {
            const [_, items] = results[0] as any

            for (const [id, fields] of items) {
              const serialized = fields[1]! // field value is at index 1 (index 0 is field name 'data')
              const payload = this.deserializePayload(id, serialized)
              resumePayloadIds.add(id)
              originalListener(payload)
            }
          }
        }
      }
      catch (error) {
        // error can happen when result from xread is invalid
        onError?.(error as ThrowableError)
      }
      finally {
        const pending = pendingPayloads
        pendingPayloads = undefined

        for (const payload of pending) {
          listener(payload) // listener instead of originalListener for deduplication
        }
      }
    })()

    const cleanupListeners = once(() => {
      listeners.splice(listeners.indexOf(listener), 1)

      if (onError) {
        const onErrors = this.onErrorsMap.get(key)
        if (onErrors) {
          onErrors.splice(onErrors.indexOf(onError), 1)
        }
      }
    })

    return async () => {
      cleanupListeners()

      if (listeners.length === 0) { // onErrors always has lower length than listeners
        this.listenersMap.delete(key)
        this.onErrorsMap.delete(key)

        const subscription = this.subscriptionsMap.get(key)

        if (subscription) {
          this.subscriptionsMap.delete(key)

          // should execute all logic before async to avoid race condition problem
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
