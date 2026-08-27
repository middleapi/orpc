import type { CacheEntry, CacheOutputSerializer, CacheSetOptions, CacheStore } from '@orpc/cache'
import { createRpcJsonOutputSerializer, encodeCacheTagHeader } from '@orpc/cache'
import { stringifyJSON, toArray } from '@orpc/shared'

/**
 * The purge API accepts a limited number of tags per call, so larger
 * revalidations are split into batches of this size.
 */
const PURGE_TAGS_BATCH_SIZE = 100

interface CloudflareCacheApiCacheStoreEnvelope {
  /**
   * The cached output, encoded with the store's serializer.
   */
  output: string
  tags: readonly string[]
  expiresAt?: number | undefined
  evictAt?: number | undefined
}

export interface CloudflareCacheApiCacheStoreOptions {
  /**
   * The Cache API instance to store entries in.
   *
   * @default caches.default
   */
  cache?: Cache

  /**
   * Serializer for cached outputs.
   *
   * @default an RPCJsonSerializer-backed serializer preserving Date, BigInt, Set, Map, URL, RegExp, NaN, and undefined values
   */
  serializer?: CacheOutputSerializer
}

/**
 * Cache store adapter for the Cloudflare Cache API with tag purging through
 * Cloudflare's purge API. Entries are stored per data center under synthetic
 * URLs below `baseUrl` and carry their tags in a `Cache-Tag` header;
 * revalidations purge those tags zone-wide via Instant Purge.
 *
 * @remarks
 * **Note**: `baseUrl` must live under the purged zone, the API token needs
 * the Zone > Cache Purge permission, and purge calls are subject to your
 * plan's purge rate limits. The Cache API is inert in dashboard previews and
 * each data center caches entries independently.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class CloudflareCacheApiCacheStore implements CacheStore {
  private readonly baseUrl: string
  private readonly zoneId: string
  private readonly apiToken: string
  private readonly cache: Cache | undefined
  private readonly serializer: CacheOutputSerializer

  constructor(
    options: {
      /**
       * An URL under your zone used to derive the synthetic cache keys,
       * e.g. `https://example.com/__orpc/cache`.
       */
      baseUrl: string

      /**
       * The zone ID used for tag purges.
       */
      zoneId: string

      /**
       * An API token with the Zone > Cache Purge permission.
       */
      apiToken: string
    } & CloudflareCacheApiCacheStoreOptions,
  ) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.zoneId = options.zoneId
    this.apiToken = options.apiToken
    this.cache = options.cache
    this.serializer = options.serializer ?? createRpcJsonOutputSerializer('CloudflareCacheApiCacheStore')
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    const response = await this.resolveCache().match(this.entryUrl(key))

    if (!response) {
      return undefined
    }

    const envelope = await response.json() as CloudflareCacheApiCacheStoreEnvelope

    if (envelope.evictAt !== undefined && Date.now() >= envelope.evictAt) {
      await this.resolveCache().delete(this.entryUrl(key))
      return undefined
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

    const retention = options?.ttl !== undefined ? options.ttl + (options.swr ?? 0) : undefined
    const expiresAt = options?.ttl !== undefined ? Date.now() + options.ttl : undefined
    const evictAt = retention !== undefined ? Date.now() + retention : undefined

    const envelope: CloudflareCacheApiCacheStoreEnvelope = {
      output: serialized,
      tags,
      expiresAt,
      evictAt,
    }

    const headers: Record<string, string> = {
      /**
       * The Cache API is ephemeral, so entries without a ttl are retained
       * for a year and evicted earlier under storage pressure.
       */
      'cache-control': `public, s-maxage=${retention !== undefined ? Math.ceil(retention / 1000) : 31536000}`,
    }

    if (tags.length) {
      headers['cache-tag'] = encodeCacheTagHeader(tags)
    }

    await this.resolveCache().put(this.entryUrl(key), new Response(stringifyJSON(envelope), { headers }))
  }

  async revalidateTag(tag: string | readonly string[]): Promise<void> {
    const tags = toArray(tag)

    for (let i = 0; i < tags.length; i += PURGE_TAGS_BATCH_SIZE) {
      const batch = tags.slice(i, i + PURGE_TAGS_BATCH_SIZE)

      const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${this.zoneId}/purge_cache`, {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${this.apiToken}`,
          'content-type': 'application/json',
        },
        body: stringifyJSON({
          // Tags must match the stored Cache-Tag header, so each one is encoded the same way.
          tags: batch.map(t => encodeCacheTagHeader([t])),
        }),
      })

      const result = await response.json() as { success?: boolean, errors?: { message?: string }[] }

      if (!response.ok || !result.success) {
        const messages = toArray(result.errors).map(error => error.message).filter(Boolean).join('; ')
        throw new Error(`CloudflareCacheApiCacheStore failed to purge tags (status ${response.status})${messages ? `: ${messages}` : ''}`)
      }
    }
  }

  private resolveCache(): Cache {
    // Cast because Cloudflare's `caches.default` is not part of the standard CacheStorage typings.
    return this.cache ?? (caches as unknown as { default: Cache }).default
  }

  private entryUrl(key: string): string {
    return `${this.baseUrl}/${encodeURIComponent(key)}`
  }
}
