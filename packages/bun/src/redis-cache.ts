import type { CacheEntry, CacheRevalidateOptions, CacheSetOptions, CacheStore } from '@orpc/experimental-cache'
import type { Public } from '@orpc/shared'
import type { RedisClient } from 'bun'
import { RPCJsonSerializer, RPCSerializer } from '@orpc/client'
import { encodeCacheKey } from '@orpc/experimental-cache'
import { nowInSeconds, sleep, stringifyJSON } from '@orpc/shared'

/**
 * Deletes the lock only while it still holds the caller's token, leaving one
 * that expired and was taken over alone.
 */
const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

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

  /**
   * How long a lock may be held, in seconds, so a crashed holder frees its
   * waiters. A fill outlasting it lets the next waiter fill as well.
   *
   * @default 10
   */
  lockTtl?: number
}

/**
 * Cache store adapter for Bun's built-in Redis client with tag-based
 * invalidation. Shares its key and envelope format with `RedisCacheStore`,
 * so both can serve the same database. Entries are retained for `ttl + swr`
 * via `EX` expiry; tag counters have no expiry since expiring one would
 * resurrect stale entries. Revalidated entries are removed lazily on the
 * next `get` of their key. Locks are held in Redis with `SET NX`, so they
 * span processes.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class BunRedisCacheStore implements CacheStore {
  private readonly prefix: string
  private readonly serializer: Public<RPCSerializer>
  private readonly lockTtl: number

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
    this.lockTtl = options.lockTtl ?? 10
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

  async lock<T>(key: unknown, fn: (waited: boolean) => Promise<T>): Promise<T> {
    const lockKey = this.lockKey(key)
    const token = crypto.randomUUID()
    let waited = false

    while (await this.redis.set(lockKey, token, 'PX', String(this.lockTtl * 1000), 'NX') === null) {
      waited = true
      await sleep(50) // until the holder releases, or its ttl passes
    }

    try {
      return await fn(waited)
    }
    finally {
      await this.redis.send('EVAL', [RELEASE_LOCK_SCRIPT, '1', lockKey, token])
    }
  }

  private entryKey(key: unknown): string {
    return `${this.prefix}e:${encodeCacheKey(key, this.keySerializer)}`
  }

  private tagKey(tag: string): string {
    return `${this.prefix}t:${tag}`
  }

  private lockKey(key: unknown): string {
    return `${this.prefix}l:${encodeCacheKey(key, this.keySerializer)}`
  }
}
