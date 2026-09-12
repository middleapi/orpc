import type { Redis } from '@upstash/redis'
import type { BaseRedisCacheStoreOptions } from './base-redis'
import { BaseRedisCacheStore } from './base-redis'

export type UpstashCacheStoreOptions = BaseRedisCacheStoreOptions

/**
 * Cache store adapter for Upstash Redis. Shares its key and entry format with
 * `RedisCacheStore`, so both can serve the same database, and runs the
 * scripts by sha through the client's own script cache.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class UpstashCacheStore extends BaseRedisCacheStore {
  private readonly scripts = new Map<string, ReturnType<Redis['createScript']>>()

  constructor(
    private readonly redis: Redis,
    options: UpstashCacheStoreOptions = {},
  ) {
    super(options)
  }

  protected run(script: string, keys: string[], args: string[]): Promise<unknown> {
    let prepared = this.scripts.get(script)

    if (prepared === undefined) {
      prepared = this.redis.createScript(script)
      this.scripts.set(script, prepared)
    }

    return prepared.exec(keys, args)
  }
}
