import type { CacheEntry, CacheRevalidateOptions, CacheSetOptions, CacheStore } from '@orpc/experimental-cache'
import type { Public } from '@orpc/shared'
import type { RedisClient } from 'bun'
import { RPCJsonSerializer, RPCSerializer } from '@orpc/client'
import { encodeCacheKey } from '@orpc/experimental-cache'
import { nowInSeconds, stringifyJSON } from '@orpc/shared'

interface BunRedisCacheStoreEnvelope {
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

export interface BunRedisCacheStoreOptions {
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
 * Cache store adapter for Bun's built-in Redis client with tag-based
 * invalidation. Shares its key and envelope format with `RedisCacheStore`,
 * so both can serve the same database. Entries are retained for `ttl + swr`
 * via `EX` expiry; tag counters have no expiry since expiring one would
 * resurrect stale entries. Revalidated entries are removed lazily on the
 * next `get` of their key.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class BunRedisCacheStore implements CacheStore {
  private readonly prefix: string
  private readonly serializer: Public<RPCSerializer>

  /**
   * Key encoding has no serializer option, so one is built here rather than
   * per call by {@link encodeCacheKey}.
   */
  private readonly keySerializer = new RPCJsonSerializer()

  constructor(
    private readonly redis: RedisClient,
    options: BunRedisCacheStoreOptions = {},
  ) {
    this.prefix = options.prefix ?? ''
    this.serializer = options.serializer ?? new RPCSerializer()
  }

  async get(key: unknown): Promise<CacheEntry | undefined> {
    const entryKey = this.entryKey(key)
    const raw = await this.redis.get(entryKey)

    if (raw === null) {
      return undefined
    }

    const envelope = JSON.parse(raw) as BunRedisCacheStoreEnvelope

    if (envelope.tags?.length) {
      const versions = await this.redis.mget(...envelope.tags.map(tag => this.tagKey(tag)))

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

    const tags = options?.tags

    let tagVersions: Record<string, number> | undefined
    if (tags?.length) {
      const versions = await this.redis.mget(...tags.map(tag => this.tagKey(tag)))
      tagVersions = {}
      tags.forEach((tag, index) => {
        tagVersions![tag] = Number(versions[index] ?? 0)
      })
    }

    const expiresAt = options?.ttl !== undefined ? nowInSeconds() + options.ttl : undefined
    const retention = options?.ttl !== undefined ? options.ttl + (options.swr ?? 0) : undefined

    const envelope: BunRedisCacheStoreEnvelope = {
      output: serialized,
      tags,
      tagVersions,
      expiresAt,
    }

    const entryKey = this.entryKey(key)
    const value = stringifyJSON(envelope)

    if (retention !== undefined) {
      await this.redis.set(entryKey, value, 'EX', retention)
    }
    else {
      await this.redis.set(entryKey, value)
    }
  }

  async revalidate({ tags }: CacheRevalidateOptions): Promise<void> {
    // The client pipelines these into a single round trip.
    await Promise.all(tags.map(tag => this.redis.incr(this.tagKey(tag))))
  }

  private entryKey(key: unknown): string {
    return `${this.prefix}e:${encodeCacheKey(key, this.keySerializer)}`
  }

  private tagKey(tag: string): string {
    return `${this.prefix}t:${tag}`
  }
}
