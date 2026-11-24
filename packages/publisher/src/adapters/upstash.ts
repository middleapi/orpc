import type { ThrowableError } from '@orpc/shared'
import { promiseWithResolvers, stringifyJSON, tryOrUndefined } from '@orpc/shared'
import type { Redis } from '@upstash/redis'

import type { BaseRedisPublisherOptions, RedisStreamEntry } from './base-redis'
import { BaseRedisPublisher } from './base-redis'

/**
 * `@upstash/redis` puts the channel unencoded in the subscribe URL, which `fetch` may rewrite
 * and the server may percent-decode. A `,` breaks the SDK's `message,<channel>,<data>` frames.
 */
// oxlint-disable-next-line no-control-regex
const UNSAFE_SUBSCRIBE_CHANNEL_REGEX = /[\x00-\x1F\x7F/\\?#%,]| $|^\.\.?$/

export interface UpstashPublisherOptions extends BaseRedisPublisherOptions {}

/**
 * Publisher adapter for Upstash Redis. Distributes events across processes via
 * Upstash Pub/Sub, with optional resume support backed by Redis Streams.
 *
 * @see {@link https://orpc.dev/docs/helpers/publisher#adapters | Publisher Helpers - Adapters}
 */
export class UpstashPublisher<T extends Record<string, object>> extends BaseRedisPublisher<T> {
  private readonly listenersMap = new Map<string, Array<(message: unknown) => void>>()
  private readonly onErrorsMap = new Map<string, Array<(error: ThrowableError) => void>>()
  private readonly subscriptionMap = new Map<string, ReturnType<Redis['subscribe']>>()
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
    return new UpstashPublisher(this.redis, {
      ...this.options,
      prefix: `${this.keyPrefix}${prefix}`,
    })
  }

  protected async publishMessage(channel: string, message: string): Promise<void> {
    await this.redis.publish(channel, message)
  }

  protected async subscribeChannel(
    channel: string,
    listener: (message: unknown) => void,
    onError?: (error: ThrowableError) => void,
  ): Promise<() => Promise<void>> {
    if (UNSAFE_SUBSCRIBE_CHANNEL_REGEX.test(channel)) {
      throw new TypeError(
        `UpstashPublisher: cannot subscribe to ${stringifyJSON(channel)}. A channel (prefix + event name) must not contain "/", "\\", "?", "#", "%", "," or control characters, end with a space, or be "." or "..".`,
      )
    }

    // Registered before subscribing so messages that arrive meanwhile are not lost.
    push(this.listenersMap, channel, listener)

    try {
      await this.subscribeIfNeeded(channel)
    } catch (error) {
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
    const results = (await this.redis.xread(key, lastId)) as null | Array<
      [key: string, entries: Array<[id: string, fields: [name: string, value: unknown]]>]
    >

    return results?.[0]?.[1].map(([id, fields]) => ({ id, data: fields[1] })) ?? []
  }

  private async subscribeIfNeeded(channel: string): Promise<void> {
    while (this.pendingSubscriptionsMap.has(channel)) {
      await this.pendingSubscriptionsMap.get(channel)!.catch(() => {}) // a failed attempt is reported to its owner; waiters retry
    }

    if (this.subscriptionMap.has(channel)) {
      return
    }

    const { promise, resolve, reject } = promiseWithResolvers<void>()
    const subscription = this.redis.subscribe(channel)

    subscription.on('subscribe', () => resolve())
    subscription.on('error', (error) => {
      reject(error)
      this.onErrorsMap
        .get(channel)
        ?.slice()
        .forEach((onError) => onError(error))
    })
    subscription.on('message', ({ channel: messageChannel, message }) => {
      if (messageChannel !== channel) {
        return
      }

      // Snapshot, since a listener may unsubscribe itself mid-dispatch.
      this.listenersMap
        .get(channel)
        ?.slice()
        .forEach((listener) => tryOrUndefined(() => listener(message)))
    })

    this.pendingSubscriptionsMap.set(channel, promise)

    try {
      await promise
      this.subscriptionMap.set(channel, subscription)
    } catch (error) {
      await subscription.unsubscribe()
      throw error
    } finally {
      this.pendingSubscriptionsMap.delete(channel)
    }
  }

  private async unsubscribeIfUnused(channel: string): Promise<void> {
    // No need to await a pending attempt: its owner still holds a listener, which blocks teardown below.
    const subscription = this.subscriptionMap.get(channel)

    if (subscription && !this.listenersMap.has(channel)) {
      this.subscriptionMap.delete(channel) // before awaiting, so concurrent callers skip it
      await subscription.unsubscribe()
    }
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  let values = map.get(key)

  if (!values) {
    map.set(key, (values = []))
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
