import type { StandardRPCJsonSerializedMetaItem, StandardRPCJsonSerializerOptions } from '@orpc/client/standard'
import type { ThrowableError } from '@orpc/shared'
import type Redis from 'ioredis'
import type { PublisherOptions, PublisherSubscribeListenerOptions } from '../publisher'
import { StandardRPCJsonSerializer } from '@orpc/client/standard'
import { fallback, once, stringifyJSON } from '@orpc/shared'
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
  protected readonly subscriptionPromiseMap = new Map<string, Promise<any>>()
  protected readonly listenersMap = new Map<string, Array<(payload: any) => void>>()
  protected readonly onErrorsMap = new Map<string, Array<(error: ThrowableError) => void>>()
  protected redisListenerAndOnError: undefined | {
    listener: (channel: string, message: string) => void
    onError: (error: ThrowableError) => void
  }

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
    let size = this.redisListenerAndOnError ? 1 : 0
    for (const listeners of this.listenersMap) {
      size += listeners[1].length || 1 // empty array should never happen so we treat it as a single event
    }
    for (const onErrors of this.onErrorsMap) {
      size += onErrors[1].length || 1 // empty array should never happen so we treat it as a single event
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

    if (!this.redisListenerAndOnError) {
      const redisOnError = (error: ThrowableError) => {
        for (const [_, onErrors] of this.onErrorsMap) {
          for (const onError of onErrors) {
            onError(error)
          }
        }
      }

      const redisListener = (channel: string, message: string) => {
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
        catch (error) {
          // error can happen when message is invalid
          const onErrors = this.onErrorsMap.get(channel)
          if (onErrors) {
            for (const onError of onErrors) {
              onError(error as ThrowableError)
            }
          }
        }
      }

      this.redisListenerAndOnError = { listener: redisListener, onError: redisOnError }
      this.listener.on('message', redisListener)
      this.listener.on('error', redisOnError)
    }

    const subscriptionPromise = this.subscriptionPromiseMap.get(key)
    if (subscriptionPromise) {
      // Avoid race conditions when multiple listeners subscribe to the same channel at once.
      // Await only if subscriptionPromise exists, and ensure no other `await` occurs between its set and await.
      await subscriptionPromise
    }
    let listeners = this.listenersMap.get(key)
    if (!listeners) {
      try {
        const promise = this.listener.subscribe(key)
        this.subscriptionPromiseMap.set(key, promise)
        await promise
        this.listenersMap.set(key, listeners = []) // only set after subscribe successfully
      }
      finally {
        this.subscriptionPromiseMap.delete(key)

        if (this.listenersMap.size === 0) { // error happen + no listener
          this.listener.off('message', this.redisListenerAndOnError.listener)
          this.listener.off('error', this.redisListenerAndOnError.onError)
          this.redisListenerAndOnError = undefined
        }
      }
    }
    listeners.push(listener)

    if (onError) { // add onError after subscribe success
      let onErrors = this.onErrorsMap.get(key)
      if (!onErrors) {
        this.onErrorsMap.set(key, onErrors = [])
      }
      onErrors.push(onError)
    }

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
      catch (error) {
        // error happen when message is invalid
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
          const index = onErrors.indexOf(onError)
          if (index !== -1) {
            onErrors.splice(index, 1)
          }
        }
      }
    })

    return async () => {
      cleanupListeners()

      if (listeners.length === 0) { // onErrors always has lower length than listeners
        this.listenersMap.delete(key)
        this.onErrorsMap.delete(key)

        if (this.redisListenerAndOnError && this.listenersMap.size === 0) {
          this.listener.off('message', this.redisListenerAndOnError.listener)
          this.listener.off('error', this.redisListenerAndOnError.onError)
          this.redisListenerAndOnError = undefined
        }

        // should execute all logic before async to avoid race condition problem
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
