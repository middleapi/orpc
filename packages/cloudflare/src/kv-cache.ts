import type { CacheEntry, CacheRevalidateOptions, CacheSetOptions, CacheStore } from '@orpc/experimental-cache'
import type { Public } from '@orpc/shared'
import { RPCJsonSerializer, RPCSerializer } from '@orpc/client'
import { encodeCacheKey } from '@orpc/experimental-cache'
import { nowInSeconds, stringifyJSON } from '@orpc/shared'

interface KVCacheStoreEnvelope {
  /**
   * The cached output, encoded with the store's serializer.
   */
  output: unknown
  tags?: readonly string[]
  /**
   * Tag tokens snapshotted at set time. A tag's live token changes on every
   * revalidation, so a mismatch (or a token appearing/disappearing) means
   * the entry is invalid.
   */
  tagTokens?: Record<string, string | null>
  expiresAt?: number | undefined
  evictAt?: number | undefined
}

export interface experimental_KVCacheStoreOptions {
  /**
   * The prefix to use for KV keys.
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
 * Cache store adapter for Cloudflare Workers KV with tag-based invalidation.
 * Tags are tracked with random tokens rewritten on every revalidation, so no
 * atomic operations are required. Entries are retained for `ttl + swr` via
 * `expirationTtl`, clamped to KV's 60 second minimum; the exact bounds are
 * still enforced on `get`.
 *
 * @remarks
 * **Note**: KV is [eventually consistent](https://developers.cloudflare.com/kv/concepts/how-kv-works/#consistency):
 * writes and revalidations may take 60 seconds or more to be visible in other
 * locations, so recently invalidated entries can still be served there.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class experimental_KVCacheStore implements CacheStore {
  private readonly prefix: string
  private readonly serializer: Public<RPCSerializer>

  /**
   * Key encoding has no serializer option, so one is built here rather than
   * per call by {@link encodeCacheKey}.
   */
  private readonly keySerializer = new RPCJsonSerializer()

  constructor(
    private readonly kv: KVNamespace,
    options: experimental_KVCacheStoreOptions = {},
  ) {
    this.prefix = options.prefix ?? ''
    this.serializer = options.serializer ?? new RPCSerializer()
  }

  async get(key: unknown): Promise<CacheEntry | undefined> {
    const entryKey = this.entryKey(key)
    const envelope = await this.kv.get<KVCacheStoreEnvelope>(entryKey, 'json')

    if (envelope === null) {
      return undefined
    }

    if (envelope.evictAt !== undefined && nowInSeconds() >= envelope.evictAt) {
      await this.kv.delete(entryKey)
      return undefined
    }

    if (envelope.tags?.length) {
      const tokens = await Promise.all(envelope.tags.map(tag => this.kv.get(this.tagKey(tag))))

      const revalidated = envelope.tags.some(
        (tag, index) => tokens[index] !== (envelope.tagTokens?.[tag] ?? null),
      )

      if (revalidated) {
        await this.kv.delete(entryKey)
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

    let tagTokens: Record<string, string | null> | undefined
    if (tags?.length) {
      const tokens = await Promise.all(tags.map(tag => this.kv.get(this.tagKey(tag))))
      tagTokens = {}
      tags.forEach((tag, index) => {
        tagTokens![tag] = tokens[index] ?? null
      })
    }

    const retention = options?.ttl !== undefined ? options.ttl + (options.swr ?? 0) : undefined
    const expiresAt = options?.ttl !== undefined ? nowInSeconds() + options.ttl : undefined
    const evictAt = retention !== undefined ? nowInSeconds() + retention : undefined

    const envelope: KVCacheStoreEnvelope = {
      output: serialized,
      tags,
      tagTokens,
      expiresAt,
      evictAt,
    }

    await this.kv.put(
      this.entryKey(key),
      stringifyJSON(envelope),
      // KV rejects expirations under 60 seconds; evictAt still enforces the exact bound on get.
      retention !== undefined ? { expirationTtl: Math.max(60, retention) } : {},
    )
  }

  async revalidate({ tags }: CacheRevalidateOptions): Promise<void> {
    await Promise.all(tags.map(tag => this.kv.put(this.tagKey(tag), crypto.randomUUID())))
  }

  private entryKey(key: unknown): string {
    return `${this.prefix}e:${encodeCacheKey(key, this.keySerializer)}`
  }

  private tagKey(tag: string): string {
    return `${this.prefix}t:${tag}`
  }
}
