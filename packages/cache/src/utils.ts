import type { RPCJsonSerializer } from '@orpc/client'
import type { Public } from '@orpc/shared'
import { deepSortKeys, stringifyJSON } from '@orpc/shared'

import type { CacheEntry, CacheGetOrSetOptions } from './types'

/**
 * Encodes a cache key into a stable string. Strings are used verbatim; other
 * values are serialized and canonicalized, so structurally equal keys encode
 * identically. Throws on blobs, which cannot be encoded.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export function encodeCacheKey(key: unknown, serializer: Public<RPCJsonSerializer>): string {
  if (typeof key === 'string' && (!key.startsWith('{') || !key.endsWith('}'))) {
    return key
  }

  const { json, meta, blobs } = serializer.serializeJson(key)

  if (blobs?.length) {
    throw new Error('Cache keys cannot contain Blob or File values. Set a `key` without them.')
  }

  return stringifyJSON({
    j: deepSortKeys(json),
    // oxlint-disable-next-line unicorn/no-array-sort
    m: meta?.map((entry) => stringifyJSON(entry)).sort(),
  })
}

/**
 * Whether the entry is past its fresh lifetime.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export function isCacheEntryStale(entry: CacheEntry): boolean {
  return entry.expiresAt !== undefined && Date.now() >= entry.expiresAt
}

/**
 * Whether the entry is past the window it may still be served in.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export function isCacheEntryEvicted(entry: Pick<CacheEntry, 'evictAt'>): boolean {
  return entry.evictAt !== undefined && Date.now() >= entry.evictAt
}

/**
 * Resolves `ttl` and `swr` into `expiresAt`, `evictAt` and a `retention` in
 * whole milliseconds, all `undefined` when the entry never expires.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export function resolveCacheExpiry({ ttl, swr = 0 }: CacheGetOrSetOptions): {
  expiresAt: number | undefined
  evictAt: number | undefined
  retention: number | undefined
} {
  if (ttl === undefined) {
    return { expiresAt: undefined, evictAt: undefined, retention: undefined }
  }

  const expiresAt = Date.now() + ttl

  return { expiresAt, evictAt: expiresAt + swr, retention: Math.ceil(ttl + swr) }
}

/**
 * Builds the entry holding `output` under the given options, along with its `retention`.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export function createCacheEntry(
  output: unknown,
  options: CacheGetOrSetOptions,
): { entry: CacheEntry; retention: number | undefined } {
  const { retention, ...expiry } = resolveCacheExpiry(options)

  return {
    entry: { output, tags: options.tags?.length ? options.tags : undefined, ...expiry },
    retention,
  }
}
