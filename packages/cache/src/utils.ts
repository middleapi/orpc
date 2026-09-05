import type { RPCJsonSerializer } from '@orpc/client'
import type { Public } from '@orpc/shared'
import { deepSortKeys, stringifyJSON } from '@orpc/shared'

/**
 * Encodes a cache key into a stable string: strings are used verbatim, while
 * any other value is serialized with the RPC JSON serializer first, so
 * complex values become plain JSON, then canonicalized by sorting object
 * keys and meta entries. Structurally equal keys always encode identically,
 * and unsupported values like blobs are ignored.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export function encodeCacheKey(key: unknown, serializer: Public<RPCJsonSerializer>): string {
  if (typeof key === 'string') {
    return key
  }

  const { json, meta } = serializer.serialize(key)

  return stringifyJSON([deepSortKeys(json), meta?.map(entry => stringifyJSON(entry)).sort()])
}

/**
 * A per-key mutex for one process, backing `CacheStore.lock` where the
 * backend has no atomic primitive. Callers of one key run one at a time in
 * order, while other keys run independently.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class MemoryLock {
  private readonly pending = new Map<string, Promise<unknown>>()

  async run<T>(key: string, fn: (waited: boolean) => Promise<T>): Promise<T> {
    const previous = this.pending.get(key)
    const run = () => fn(previous !== undefined)
    // A failed predecessor still hands the turn on.
    const current = previous === undefined ? run() : previous.then(run, run)

    this.pending.set(key, current)

    try {
      return await current
    }
    finally {
      if (this.pending.get(key) === current) {
        this.pending.delete(key)
      }
    }
  }
}
