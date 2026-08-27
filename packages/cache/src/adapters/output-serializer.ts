import type { RPCJsonSerialization } from '@orpc/client'
import { RPCJsonSerializer } from '@orpc/client'
import { stringifyJSON } from '@orpc/shared'

/**
 * Serializes cached outputs to strings and back, used by cache store adapters.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export interface CacheOutputSerializer {
  stringify(data: unknown): string
  parse(text: string): unknown
}

/**
 * Creates the default output serializer for cache store adapters, backed by
 * the RPC JSON serializer so Date, BigInt, Set, Map, URL, RegExp, NaN, and
 * undefined values survive the round trip. Outputs containing Blob or File
 * values are rejected with a TypeError naming `storeName`.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export function createRpcJsonOutputSerializer(storeName: string): CacheOutputSerializer {
  // Cached outputs should round-trip exactly, so undefined properties are kept
  // even though the RPC protocol omits them over the wire.
  const jsonSerializer = new RPCJsonSerializer({ omitUndefinedProperties: false })

  return {
    stringify(data) {
      const { json, meta, maps, blobs } = jsonSerializer.serialize(data)

      if (blobs?.length) {
        throw new TypeError(`${storeName} cannot cache outputs containing Blob or File values`)
      }

      return stringifyJSON({ json, meta, maps })
    },
    parse(text) {
      return jsonSerializer.deserialize(JSON.parse(text) as RPCJsonSerialization)
    },
  }
}
