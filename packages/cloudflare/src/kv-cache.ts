import type { CacheEntry, CacheOutputSerializer, CacheSetOptions, CacheStore } from '@orpc/cache'
import { createRpcJsonOutputSerializer } from '@orpc/cache'
import { stringifyJSON, toArray } from '@orpc/shared'

interface KVCacheStoreEnvelope {
  /**
   * The cached output, encoded with the store's serializer.
   */
  output: string
  tags: readonly string[]
  /**
   * Tag tokens snapshotted at set time. A tag's live token changes on every
   * revalidation, so a mismatch (or a token appearing/disappearing) means
   * the entry is invalid.
   */
  tagTokens: Record<string, string | null>
  expiresAt?: number | undefined
  evictAt?: number | undefined
}

export interface KVCacheStoreOptions {
  /**
   * The KV namespace to store entries in.
   */
  kv: KVNamespace

  /**
   * The prefix to use for KV keys.
   *
   * @default undefined
   */
  prefix?: string

  /**
   * Serializer for cached outputs.
   *
   * @default an RPCJsonSerializer-backed serializer preserving Date, BigInt, Set, Map, URL, RegExp, NaN, and undefined values
   */
  serializer?: CacheOutputSerializer
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
export class KVCacheStore implements CacheStore {
  private readonly kv: KVNamespace
  private readonly prefix: string
  private readonly serializer: CacheOutputSerializer

  constructor(options: KVCacheStoreOptions) {
    this.kv = options.kv
    this.prefix = options.prefix ?? ''
    this.serializer = options.serializer ?? createRpcJsonOutputSerializer('KVCacheStore')
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    const envelope = await this.kv.get<KVCacheStoreEnvelope>(this.entryKey(key), 'json')

    if (envelope === null) {
      return undefined
    }

    if (envelope.evictAt !== undefined && Date.now() >= envelope.evictAt) {
      await this.kv.delete(this.entryKey(key))
      return undefined
    }

    if (envelope.tags.length) {
      const tokens = await Promise.all(envelope.tags.map(tag => this.kv.get(this.tagKey(tag))))

      const revalidated = envelope.tags.some(
        (tag, index) => tokens[index] !== (envelope.tagTokens[tag] ?? null),
      )

      if (revalidated) {
        await this.kv.delete(this.entryKey(key))
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
    const tags = options?.tags ?? []
    const serialized = this.serializer.stringify(output)

    const tagTokens: Record<string, string | null> = {}
    if (tags.length) {
      const tokens = await Promise.all(tags.map(tag => this.kv.get(this.tagKey(tag))))
      tags.forEach((tag, index) => {
        tagTokens[tag] = tokens[index] ?? null
      })
    }

    const retention = options?.ttl !== undefined ? options.ttl + (options.swr ?? 0) : undefined
    const expiresAt = options?.ttl !== undefined ? Date.now() + options.ttl : undefined
    const evictAt = retention !== undefined ? Date.now() + retention : undefined

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
      retention !== undefined ? { expirationTtl: Math.max(60, Math.ceil(retention / 1000)) } : {},
    )
  }

  async revalidateTag(tag: string | readonly string[]): Promise<void> {
    const tags = toArray(tag)

    if (!tags.length) {
      return
    }

    await Promise.all(tags.map(t => this.kv.put(this.tagKey(t), crypto.randomUUID())))
  }

  private entryKey(key: string): string {
    return `${this.prefix}entry:${key}`
  }

  private tagKey(tag: string): string {
    return `${this.prefix}tag:${tag}`
  }
}
