import type { Public } from '@orpc/shared'
import { RPCJsonSerializer } from '@orpc/client'
import { deepSortKeys, stringifyJSON } from '@orpc/shared'

const defaultKeySerializer = new RPCJsonSerializer()

/**
 * Encodes a cache key into a stable string: strings are used verbatim, while
 * any other value is serialized with the RPC JSON serializer first, so
 * complex values become plain JSON, then canonicalized by sorting object
 * keys and meta entries. Structurally equal keys always encode identically,
 * and unsupported values like blobs are ignored.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export function encodeCacheKey(key: unknown, serializer: Public<RPCJsonSerializer> = defaultKeySerializer): string {
  if (typeof key === 'string') {
    return key
  }

  const { json, meta } = serializer.serialize(key)

  return `${stringifyJSON(deepSortKeys([json, meta?.map(entry => stringifyJSON(entry)).sort()]))}`
}
