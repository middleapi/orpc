import type { ThrowableError } from '@orpc/shared'
import type { Redis } from '@upstash/redis'
import type { BaseRedisPublisherOptions, RedisStreamEntry } from './base-redis'
import { promiseWithResolvers, tryOrUndefined } from '@orpc/shared'
import { BaseRedisPublisher } from './base-redis'

export interface UpstashPublisherOptions extends BaseRedisPublisherOptions {}

interface ChannelSubscription {
  subscription: ReturnType<Redis['subscribe']>
  /** Set when the established stream fails, since Upstash does not reconnect. */
  error?: ThrowableError
}

/**
 * Publisher adapter for Upstash Redis. Distributes events across processes via
 * Upstash Pub/Sub, with optional resume support backed by Redis Streams.
 *
 * @see {@link https://orpc.dev/docs/helpers/publisher#adapters | Publisher Helpers - Adapters}
 */
export class UpstashPublisher<T extends Record<string, object>> extends BaseRedisPublisher<T> {
  private readonly listenersMap = new Map<string, Array<(message: unknown) => void>>()
  private readonly onErrorsMap = new Map<string, Array<(error: ThrowableError) => void>>()
  private readonly subscriptionMap = new Map<string, ChannelSubscription>()
  private readonly pendingSubscriptionsMap = new Map<string, Promise<void>>()

  constructor(
    private readonly redis: Redis,
    private readonly options: UpstashPublisherOptions = {},
  ) {
    super(options)
  }

  /**
   * Creates a publisher with `prefix` appended to this publisher's prefix, sharing its Redis client.
   *
   * @see {@link https://orpc.dev/docs/helpers/publisher#adapters | Publisher Helpers - Adapters}
   */
  prefix(prefix: string): UpstashPublisher<T> {
    return new UpstashPublisher(this.redis, { ...this.options, prefix: `${this.eventPrefix}${prefix}` })
  }

  protected async publishMessage(channel: string, message: string): Promise<void> {
    await this.redis.publish(channel, message)
  }

  protected async subscribeChannel(
    channel: string,
    listener: (message: unknown) => void,
    onError?: (error: ThrowableError) => void,
  ): Promise<() => Promise<void>> {
    // Registered before subscribing so messages that arrive meanwhile are not lost.
    push(this.listenersMap, channel, listener)

    try {
      const { error } = await this.subscribeIfNeeded(channel)

      // The stream may have failed before this resumed, and onError was not registered yet to report it.
      if (error) {
        throw error
      }
    }
    catch (error) {
      remove(this.listenersMap, channel, listener)
      await this.unsubscribeIfUnused(channel)
      throw error
    }

    // Registered after subscribing because a failed subscription rejects instead.
    if (onError) {
      push(this.onErrorsMap, channel, onError)
    }

    return async () => {
      remove(this.listenersMap, channel, listener)

      if (onError) {
        remove(this.onErrorsMap, channel, onError)
      }

      await this.unsubscribeIfUnused(channel)
    }
  }

  protected async evalScript(script: string, keys: string[], args: string[]): Promise<unknown> {
    return await this.redis.eval(script, keys, args)
  }

  protected async readStreamEntries(key: string, lastId: string): Promise<RedisStreamEntry[]> {
    const results = await this.redis.xread(key, lastId) as null | Array<[
      key: string,
      entries: Array<[id: string, fields: [name: string, value: unknown]]>,
    ]>

    return results?.[0]?.[1].map(([id, fields]) => ({ id, data: fields[1] })) ?? []
  }

  /**
   * Resolves with the established subscription of the channel, opening one if needed.
   */
  private async subscribeIfNeeded(channel: string): Promise<ChannelSubscription> {
    while (this.pendingSubscriptionsMap.has(channel)) {
      await this.pendingSubscriptionsMap.get(channel)!.catch(() => {}) // a failed attempt is reported to its owner; waiters retry
    }

    const existing = this.subscriptionMap.get(channel)

    if (existing) {
      return existing
    }

    const { promise, resolve, reject } = promiseWithResolvers<void>()
    const subscription = this.redis.subscribe(channel)
    const entry: ChannelSubscription = { subscription }
    let failed = false

    subscription.on('subscribe', () => {
      if (!failed && !this.subscriptionMap.has(channel)) {
        // Set synchronously, so an error right after this is handled as a failure of the established subscription.
        this.subscriptionMap.set(channel, entry)
        resolve()
      }
    })
    subscription.on('error', (error) => {
      if (this.subscriptionMap.get(channel) !== entry) {
        // Not established yet; a no-op once the attempt settled, e.g. it already failed or was torn down.
        failed = true
        reject(error)
        return
      }

      // The stream ends for good on error: Upstash does not reconnect. Drop it so the next subscribe opens a fresh one.
      entry.error = error
      this.subscriptionMap.delete(channel)
      subscription.unsubscribe().catch(() => {}) // only aborts the dead stream

      // Snapshot, since a callback may unsubscribe itself mid-dispatch.
      this.onErrorsMap.get(channel)?.slice().forEach(onError => onError(error))
    })
    subscription.on('message', ({ message }) => {
      // Snapshot, since a listener may unsubscribe itself mid-dispatch.
      // Listeners already route their failures to onError, so this only guards against a throwing onError,
      // which must neither stop delivery to the others nor reach Upstash, which would emit it as an `error` event.
      this.listenersMap.get(channel)?.slice().forEach(listener => tryOrUndefined(() => listener(message)))
    })

    this.pendingSubscriptionsMap.set(channel, promise)

    try {
      await promise
      return entry
    }
    catch (error) {
      await subscription.unsubscribe()
      throw error
    }
    finally {
      this.pendingSubscriptionsMap.delete(channel)
    }
  }

  private async unsubscribeIfUnused(channel: string): Promise<void> {
    // No need to await a pending attempt: its owner still holds a listener, which blocks teardown below.
    const entry = this.subscriptionMap.get(channel)

    if (entry && !this.listenersMap.has(channel)) {
      this.subscriptionMap.delete(channel) // before awaiting, so concurrent callers skip it
      await entry.subscription.unsubscribe()
    }
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  let values = map.get(key)

  if (!values) {
    map.set(key, values = [])
  }

  values.push(value)
}

function remove<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key)
  const index = values?.indexOf(value) ?? -1

  if (index !== -1) {
    values!.splice(index, 1)
  }

  if (values?.length === 0) {
    map.delete(key)
  }
}
