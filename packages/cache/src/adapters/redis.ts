import type { RedisClientType } from 'redis'
import type { CacheEntry, CacheSetOptions, CacheStore } from '../types'
import type { CacheOutputSerializer } from './output-serializer'
import { stringifyJSON, toArray } from '@orpc/shared'
import { createRpcJsonOutputSerializer } from './output-serializer'

export type RedisCacheStoreSerializer = CacheOutputSerializer

interface RedisCacheStoreEnvelope {
  /**
   * The cached output, encoded with the store's serializer.
   */
  output: string
  tags: readonly string[]
  /**
   * Tag version counters snapshotted at set time.
   */
  tagVersions: Record<string, number>
  expiresAt?: number | undefined
}

export interface RedisCacheStoreOptions {
  /**
   * The prefix to use for Redis keys.
   *
   * @default undefined
   */
  prefix?: string

  /**
   * Serializer for cached outputs.
   *
   * @default an RPCJsonSerializer-backed serializer preserving Date, BigInt, Set, Map, URL, RegExp, NaN, and undefined values
   */
  serializer?: RedisCacheStoreSerializer
}

/**
 * Cache store adapter for Redis with tag-based invalidation. Entries are
 * retained for `ttl + swr` via `PX` expiry; tag counters have no expiry
 * since expiring one would resurrect stale entries. Revalidated entries
 * are removed lazily on the next `get` of their key.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class RedisCacheStore implements CacheStore {
  private readonly redis: RedisClientType<any, any, any, any, any>
  private readonly prefix: string
  private readonly serializer: RedisCacheStoreSerializer

  constructor(
    redis: RedisClientType<any, any, any, any, any>,
    options: RedisCacheStoreOptions = {},
  ) {
    this.redis = redis
    this.prefix = options.prefix ?? ''
    this.serializer = options.serializer ?? createRpcJsonOutputSerializer('RedisCacheStore')
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    await this.ensureConnection()

    const raw = await this.redis.get(this.entryKey(key))

    if (raw === null) {
      return undefined
    }

    const envelope = JSON.parse(raw.toString()) as RedisCacheStoreEnvelope

    if (envelope.tags.length) {
      const versions = await this.redis.mGet(envelope.tags.map(tag => this.tagKey(tag)))

      const revalidated = envelope.tags.some(
        (tag, index) => Number(versions[index] ?? 0) !== (envelope.tagVersions[tag] ?? 0),
      )

      if (revalidated) {
        await this.redis.del(this.entryKey(key))
        return undefined
      }
    }

    return {
      output: this.serializer.parse(envelope.output),
      tags: envelope.tags,
      expiresAt: envelope.expiresAt,
    }
  }

  async set(key: string, output: unknown, options?: CacheSetOptions): Promise<void> {
    await this.ensureConnection()

    const tags = options?.tags ?? []
    const serialized = this.serializer.stringify(output)

    const tagVersions: Record<string, number> = {}
    if (tags.length) {
      const versions = await this.redis.mGet(tags.map(tag => this.tagKey(tag)))
      tags.forEach((tag, index) => {
        tagVersions[tag] = Number(versions[index] ?? 0)
      })
    }

    const expiresAt = options?.ttl !== undefined ? Date.now() + options.ttl : undefined
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
      retention !== undefined ? { expiration: { type: 'PX', value: retention } } : undefined,
    )
  }

  async revalidateTag(tag: string | readonly string[]): Promise<void> {
    await this.ensureConnection()

    const tags = toArray(tag)

    if (!tags.length) {
      return
    }

    if (tags.length === 1) {
      await this.redis.incr(this.tagKey(tags[0]!))
      return
    }

    const multi = this.redis.multi()
    for (const t of tags) {
      multi.incr(this.tagKey(t))
    }
    await multi.exec()
  }

  private entryKey(key: string): string {
    return `${this.prefix}entry:${key}`
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
