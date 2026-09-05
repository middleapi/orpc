import type { Public } from '@orpc/shared'
import type { Redis } from '@upstash/redis'
import type { CacheEntry, CacheRevalidateOptions, CacheSetOptions, CacheStore } from '../types'
import { RPCJsonSerializer, RPCSerializer } from '@orpc/client'
import { nowInSeconds, sleep, stringifyJSON } from '@orpc/shared'
import { encodeCacheKey } from '../utils'

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

interface UpstashCacheStoreEnvelope {
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

export interface UpstashCacheStoreOptions {
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
 * Cache store adapter for Upstash Redis with tag-based invalidation. Shares
 * its key and envelope format with `RedisCacheStore`, so both can serve the
 * same database. Entries are retained for `ttl + swr` via `EX` expiry; tag
 * counters have no expiry since expiring one would resurrect stale entries.
 * Revalidated entries are removed lazily on the next `get` of their key.
 * Locks are held in Redis with `SET NX`, so they span processes.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class UpstashCacheStore implements CacheStore {
  private readonly prefix: string
  private readonly serializer: Public<RPCSerializer>
  private readonly lockTtl: number

  /**
   * Key encoding has no serializer option, so one is built here rather than
   * per call by {@link encodeCacheKey}.
   */
  private readonly keySerializer = new RPCJsonSerializer()

  constructor(
    private readonly redis: Redis,
    options: UpstashCacheStoreOptions = {},
  ) {
    this.prefix = options.prefix ?? ''
    this.serializer = options.serializer ?? new RPCSerializer()
    this.lockTtl = options.lockTtl ?? 10
  }

  async get(key: unknown): Promise<CacheEntry | undefined> {
    const entryKey = this.entryKey(key)
    // The client parses JSON responses by default; a string means that is turned off.
    const raw = await this.redis.get<string | UpstashCacheStoreEnvelope>(entryKey)

    if (raw === null) {
      return undefined
    }

    const envelope = typeof raw === 'string' ? JSON.parse(raw) as UpstashCacheStoreEnvelope : raw

    if (envelope.tags?.length) {
      const versions = await this.redis.mget<(string | number | null)[]>(envelope.tags.map(tag => this.tagKey(tag)))

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
      const versions = await this.redis.mget<(string | number | null)[]>(tags.map(tag => this.tagKey(tag)))
      tagVersions = {}
      tags.forEach((tag, index) => {
        tagVersions![tag] = Number(versions[index] ?? 0)
      })
    }

    const expiresAt = options?.ttl !== undefined ? nowInSeconds() + options.ttl : undefined
    const retention = options?.ttl !== undefined ? options.ttl + (options.swr ?? 0) : undefined

    const envelope: UpstashCacheStoreEnvelope = {
      output: serialized,
      tags,
      tagVersions,
      expiresAt,
    }

    await this.redis.set(
      this.entryKey(key),
      stringifyJSON(envelope),
      retention !== undefined ? { ex: retention } : undefined,
    )
  }

  async revalidate({ tags }: CacheRevalidateOptions): Promise<void> {
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

  async lock<T>(key: unknown, fn: (waited: boolean) => Promise<T>): Promise<T> {
    const lockKey = this.lockKey(key)
    const token = crypto.randomUUID()
    let waited = false

    while (await this.redis.set(lockKey, token, { nx: true, px: this.lockTtl * 1000 }) === null) {
      waited = true
      await sleep(50) // until the holder releases, or its ttl passes
    }

    try {
      return await fn(waited)
    }
    finally {
      await this.redis.eval(RELEASE_LOCK_SCRIPT, [lockKey], [token])
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
