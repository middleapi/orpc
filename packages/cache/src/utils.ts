import type { RPCJsonSerializer } from '@orpc/client'
import type { Public } from '@orpc/shared'
import type { CacheEntry, CacheFetchOptions } from './types'
import { deepSortKeys, nowInSeconds, stringifyJSON } from '@orpc/shared'

/**
 * Encodes a cache key into a stable string: strings are used verbatim, while
 * any other value is serialized with the RPC JSON serializer first, so
 * complex values become plain JSON, then canonicalized by sorting object
 * keys and meta entries. Structurally equal keys always encode identically,
 * and unsupported values like blobs are ignored. A string shaped like a
 * serialized key is serialized too, so the two never collide.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export function encodeCacheKey(key: unknown, serializer: Public<RPCJsonSerializer>): string {
  if (typeof key === 'string' && (!key.startsWith('{') || !key.endsWith('}'))) {
    return key
  }

  const { json, meta } = serializer.serialize(key)

  return stringifyJSON({
    j: deepSortKeys(json),
    m: meta?.map(entry => stringifyJSON(entry)).sort(),
  })
}

/**
 * Whether the entry is past its fresh lifetime.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export function isCacheEntryStale(entry: CacheEntry): boolean {
  return entry.expiresAt !== undefined && nowInSeconds() >= entry.expiresAt
}

/**
 * The entry lifetime an option set describes: when it stops being fresh,
 * when it may be evicted (both unix timestamps in seconds), and how long it
 * is retained in seconds. All `undefined` when it never expires.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export function resolveCacheExpiry({ ttl, swr }: CacheFetchOptions): { expiresAt: number | undefined, evictAt: number | undefined, retention: number | undefined } {
  if (ttl === undefined) {
    return { expiresAt: undefined, evictAt: undefined, retention: undefined }
  }

  const expiresAt = nowInSeconds() + ttl

  return { expiresAt, evictAt: expiresAt + (swr ?? 0), retention: ttl + (swr ?? 0) }
}
