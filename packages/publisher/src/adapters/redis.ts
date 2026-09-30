import type { ThrowableError } from '@orpc/shared'
import type { RedisClientType } from 'redis'
import type { BaseRedisPublisherOptions, RedisStreamEntry } from './base-redis'
import { BaseRedisPublisher } from './base-redis'

export interface RedisPublisherOptions extends BaseRedisPublisherOptions {
  /**
   * Redis subscriber instance.
   * Pub/Sub takes over the connection, so a client with subscriptions
   * cannot execute commands and must use a dedicated connection.
   *
   * @default redis.duplicate()
   */
  subscriber?: undefined | RedisClientType<any, any, any, any, any>
}

/**
 * Publisher adapter for Redis. Distributes events across processes via
 * Redis Pub/Sub, with optional resume support backed by Redis Streams.
 *
 * @see {@link https://orpc.dev/docs/helpers/publisher#adapters | Publisher Helpers - Adapters}
 */
export class RedisPublisher<T extends Record<string, object>> extends BaseRedisPublisher<T> {
  private readonly subscriber: Exclude<RedisPublisherOptions['subscriber'], undefined>

  /**
   * node-redis applies `keyPrefix` to keys but not channels, while the publish script
   * publishes on its key, so channels need the same prefix.
   */
  private readonly channelPrefix: string

  /**
   * `onError` callbacks of the established subscriptions, told when the subscriber connection fails.
   */
  private readonly subscriptionErrorHandlers = new Set<(error: ThrowableError) => void>()

  /**
   * Whether the connection loss the subscriber is recovering from was reported already,
   * so it is reported once instead of for every event and failed retry it causes.
   */
  private subscriberLossReported = false

  constructor(
    private readonly redis: RedisClientType<any, any, any, any, any>,
    { subscriber, ...options }: RedisPublisherOptions = {},
  ) {
    super(options)

    const keyPrefix = redis.options?.keyPrefix

    if (keyPrefix !== undefined && typeof keyPrefix !== 'string') {
      throw new TypeError('RedisPublisher only supports a string keyPrefix on the Redis client.')
    }

    this.subscriber = subscriber ?? redis.duplicate()
    this.channelPrefix = keyPrefix ?? ''
  }

  protected async publishMessage(channel: string, message: string): Promise<void> {
    await connectIfNeeded(this.redis)
    await this.redis.publish(`${this.channelPrefix}${channel}`, message)
  }

  protected async subscribeChannel(
    channel: string,
    listener: (message: unknown) => void,
    onError?: (error: ThrowableError) => void,
  ): Promise<() => Promise<void>> {
    const prefixedChannel = `${this.channelPrefix}${channel}`

    await connectIfNeeded(this.subscriber)
    await this.subscriber.subscribe(prefixedChannel, listener)

    // Registered after subscribing because a failed subscription rejects instead.
    // Wrapped so a callback shared by several subscriptions is registered once per subscription.
    const errorHandler = onError && ((error: ThrowableError) => onError(error))

    if (errorHandler) {
      this.addSubscriptionErrorHandler(errorHandler)
    }

    return async () => {
      if (errorHandler) {
        this.removeSubscriptionErrorHandler(errorHandler)
      }

      await this.subscriber.unsubscribe(prefixedChannel, listener)
    }
  }

  protected async evalScript(script: string, keys: string[], args: string[]): Promise<unknown> {
    await connectIfNeeded(this.redis)

    return await this.redis.eval(script, { keys, arguments: args })
  }

  protected async readStreamEntries(key: string, lastId: string): Promise<RedisStreamEntry[]> {
    await connectIfNeeded(this.redis)

    const results = await this.redis.xRead({ key, id: lastId })

    const entries: Array<{ id: string, message: Record<string, string> }> = results?.[0]?.messages ?? []

    return entries.map(({ id, message }) => ({ id, data: message.data! }))
  }

  /**
   * node-redis resubscribes after reconnecting, but events published while the connection was down are
   * lost, so subscriptions are told the connection failed. Iterator subscribers then end, letting
   * clients resume with `lastEventId`. The client listeners are attached once for all subscriptions,
   * and only while one needs them, so errors are otherwise left to the client's own listeners.
   */
  private addSubscriptionErrorHandler(handler: (error: ThrowableError) => void): void {
    if (this.subscriptionErrorHandlers.size === 0) {
      this.subscriberLossReported = false

      this.subscriber
        .on('error', this.onSubscriberError)
        .on('reconnecting', this.onSubscriberReconnecting)
        .on('end', this.onSubscriberEnd)
        .on('ready', this.onSubscriberReady)
    }

    this.subscriptionErrorHandlers.add(handler)
  }

  private removeSubscriptionErrorHandler(handler: (error: ThrowableError) => void): void {
    this.subscriptionErrorHandlers.delete(handler)

    if (this.subscriptionErrorHandlers.size > 0) {
      return
    }

    this.subscriber
      .off('error', this.onSubscriberError)
      .off('reconnecting', this.onSubscriberReconnecting)
      .off('end', this.onSubscriberEnd)
      .off('ready', this.onSubscriberReady)
  }

  private reportSubscriptionError(error: ThrowableError): void {
    // Snapshot, since a handler may unsubscribe itself mid-dispatch.
    for (const handler of [...this.subscriptionErrorHandlers]) {
      handler(error)
    }
  }

  private readonly onSubscriberError = (error: ThrowableError): void => {
    // Every failed reconnection attempt emits an error, but only the first reports the loss
    if (this.subscriberLossReported) {
      return
    }

    // An error that leaves the connection up, like an undecodable reply, is reported without marking a loss
    this.subscriberLossReported = !this.subscriber.isReady
    this.reportSubscriptionError(error)
  }

  private readonly onSubscriberReconnecting = (): void => {
    this.onSubscriberLost(new Error('The Redis subscriber connection was lost and is reconnecting.'))
  }

  private readonly onSubscriberEnd = (): void => {
    this.onSubscriberLost(new Error('The Redis subscriber connection was closed.'))
  }

  private onSubscriberLost(error: ThrowableError): void {
    if (!this.subscriberLossReported) {
      this.subscriberLossReported = true
      this.reportSubscriptionError(error)
    }
  }

  private readonly onSubscriberReady = (): void => {
    this.subscriberLossReported = false
  }
}

async function connectIfNeeded(client: RedisClientType<any, any, any, any, any>): Promise<void> {
  if (!client.isOpen) {
    await client.connect()
  }
}
