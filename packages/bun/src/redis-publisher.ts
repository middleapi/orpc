import type { BaseRedisPublisherOptions, RedisStreamEntry } from '@orpc/publisher/base-redis'
import type { Promisable } from '@orpc/shared'
import type { RedisClient } from 'bun'
import { BaseRedisPublisher } from '@orpc/publisher/base-redis'

export interface BunRedisPublisherOptions extends BaseRedisPublisherOptions {
  /**
   * Redis subscriber instance.
   * Pub/Sub takes over the connection, so a client with subscriptions
   * cannot execute commands and must use a dedicated connection.
   *
   * @default redis.duplicate() (lazily created on first listen)
   */
  subscriber?: undefined | Promisable<RedisClient>
}

/**
 * Publisher adapter for Bun's built-in Redis client. Distributes events across
 * processes via Redis Pub/Sub, with optional resume support backed by Redis Streams.
 *
 * @see {@link https://orpc.dev/docs/helpers/publisher#adapters | Publisher Helpers - Adapters}
 */
export class BunRedisPublisher<T extends Record<string, object>> extends BaseRedisPublisher<T> {
  private subscriber: BunRedisPublisherOptions['subscriber']

  constructor(
    private readonly redis: RedisClient,
    { subscriber, ...options }: BunRedisPublisherOptions = {},
  ) {
    super(options)

    this.subscriber = subscriber
  }

  protected async publishMessage(channel: string, message: string): Promise<void> {
    await this.redis.publish(channel, message)
  }

  protected async subscribeChannel(channel: string, listener: (message: unknown) => void): Promise<() => Promise<void>> {
    this.subscriber ??= this.redis.duplicate()
    const subscriber = await this.subscriber

    await subscriber.subscribe(channel, listener)

    return async () => {
      await subscriber.unsubscribe(channel, listener)
    }
  }

  protected async evalScript(script: string, keys: string[], args: string[]): Promise<unknown> {
    return await this.redis.send('EVAL', [script, String(keys.length), ...keys, ...args])
  }

  protected async readStreamEntries(key: string, lastId: string): Promise<RedisStreamEntry[]> {
    const results = await this.redis.send('XREAD', ['STREAMS', key, lastId])
    const entries: Array<[id: string, fields: [name: string, value: string]]> = results?.[key] ?? []

    return entries.map(([id, fields]) => ({ id, data: fields[1] }))
  }
}
