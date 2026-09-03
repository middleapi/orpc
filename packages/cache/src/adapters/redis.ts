import type { Public } from '@orpc/shared'
import type { RedisClientType } from 'redis'
import type { CacheEntry, CacheRevalidateOptions, CacheSetOptions, CacheStore } from '../types'
import { RPCJsonSerializer, RPCSerializer } from '@orpc/client'
import { nowInSeconds, stringifyJSON } from '@orpc/shared'
import { encodeCacheKey } from '../utils'

interface RedisCacheStoreEnvelope {
  /**
   * The cached output, encoded with the store's serializer.
   */
  output: unknown
  tags?: readonly string[]
  /**
   * Tag version counters snapshotted at set time.
   */
  tagVersions?: Record<string, number>
  expiresAt?: number | undefined
}

export interface RedisCacheStoreOptions {
  /**
   * The Redis client to store entries in. Connected lazily when needed.
   */
  redis: RedisClientType<any, any, any, any, any>

  /**
   * The prefix to use for Redis keys.
   *
   * @default undefined
   */
  prefix?: string

  /**
   * Serializer for cached outputs.
   *
   * @default RPCSerializer
   */
  serializer?: undefined | Public<RPCSerializer>
}

/**
 * Cache store adapter for Redis with tag-based invalidation. Entries are
 * retained for `ttl + swr` via `EX` expiry; tag counters have no expiry
 * since expiring one would resurrect stale entries. Revalidated entries
 * are removed lazily on the next `get` of their key.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class RedisCacheStore implements CacheStore {
  private readonly redis: RedisClientType<any, any, any, any, any>
  private readonly prefix: string
  private readonly serializer: Public<RPCSerializer>

  /**
   * Key encoding has no serializer option, so one is built here rather than
   * per call by {@link encodeCacheKey}.
   */
  private readonly keySerializer = new RPCJsonSerializer()

  constructor(options: RedisCacheStoreOptions) {
    this.redis = options.redis
    this.prefix = options.prefix ?? ''
    this.serializer = options.serializer ?? new RPCSerializer()
  }

  async get(key: unknown): Promise<CacheEntry | undefined> {
    await this.ensureConnection()

    const entryKey = this.entryKey(key)
    const raw = await this.redis.get(entryKey)

    if (raw === null) {
      return undefined
    }

    const envelope = JSON.parse(raw.toString()) as RedisCacheStoreEnvelope

    if (envelope.tags?.length) {
      const versions = await this.redis.mGet(envelope.tags.map(tag => this.tagKey(tag)))

      const revalidated = envelope.tags.some(
        (tag, index) => Number(versions[index] ?? 0) !== (envelope.tagVersions?.[tag] ?? 0),
      )

      if (revalidated) {
        await this.redis.del(entryKey)
        return undefined
      }
    }

    return {
      output: this.serializer.deserialize(envelope.output as any),
      tags: envelope.tags,
      expiresAt: envelope.expiresAt,
    }
  }

  async set(key: unknown, output: unknown, options?: CacheSetOptions): Promise<void> {
    const serialized = this.serializer.serialize(output)

    await this.ensureConnection()

    const tags = options?.tags

    let tagVersions: Record<string, number> | undefined
    if (tags?.length) {
      const versions = await this.redis.mGet(tags.map(tag => this.tagKey(tag)))
      tagVersions = {}
      tags.forEach((tag, index) => {
        tagVersions![tag] = Number(versions[index] ?? 0)
      })
    }

    const expiresAt = options?.ttl !== undefined ? nowInSeconds() + options.ttl : undefined
    const retention = options?.ttl !== undefined ? options.ttl + (options.swr ?? 0) : undefined

    const envelope: RedisCacheStoreEnvelope = {
      output: serialized,
      tags,
      tagVersions,
      expiresAt,
    }

    await this.redis.set(
      this.entryKey(key),
      stringifyJSON(envelope),
      retention !== undefined ? { expiration: { type: 'EX', value: retention } } : undefined,
    )
  }

  async revalidate({ tags }: CacheRevalidateOptions): Promise<void> {
    await this.ensureConnection()

    if (tags.length === 1) {
      await this.redis.incr(this.tagKey(tags[0]))
      return
    }

    const multi = this.redis.multi()
    for (const tag of tags) {
      multi.incr(this.tagKey(tag))
    }
    await multi.exec()
  }

  private entryKey(key: unknown): string {
    return `${this.prefix}entry:${encodeCacheKey(key, this.keySerializer)}`
  }

  private tagKey(tag: string): string {
    return `${this.prefix}tag:${tag}`
  }

  private async ensureConnection(): Promise<void> {
    if (!this.redis.isOpen) {
      await this.redis.connect()
    }
  }
}
