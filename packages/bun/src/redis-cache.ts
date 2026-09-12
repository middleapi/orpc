import type { BaseRedisCacheStoreOptions } from '@orpc/experimental-cache/base-redis'
import type { RedisClient } from 'bun'
import { BaseRedisCacheStore } from '@orpc/experimental-cache/base-redis'

export type experimental_BunRedisCacheStoreOptions = BaseRedisCacheStoreOptions

/**
 * Cache store adapter for Bun's built-in Redis client. Shares its key and
 * entry format with `RedisCacheStore`, so both can serve the same database,
 * and runs the scripts by sha, loading each once per client and once more
 * when the server dropped it.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class experimental_BunRedisCacheStore extends BaseRedisCacheStore {
  private readonly scriptShas = new Map<string, string>()

  constructor(
    private readonly redis: RedisClient,
    options: experimental_BunRedisCacheStoreOptions = {},
  ) {
    super(options)
  }

  protected async run(script: string, keys: string[], args: string[]): Promise<unknown> {
    try {
      return await this.evalSha(script, keys, args)
    }
    catch (error) {
      if (error instanceof Error && error.message.startsWith('NOSCRIPT')) {
        this.scriptShas.delete(script)
        return this.evalSha(script, keys, args)
      }

      throw error
    }
  }

  private async evalSha(script: string, keys: string[], args: string[]): Promise<unknown> {
    let sha = this.scriptShas.get(script)

    if (sha === undefined) {
      sha = await this.redis.send('SCRIPT', ['LOAD', script]) as string
      this.scriptShas.set(script, sha)
    }

    return this.redis.send('EVALSHA', [sha, String(keys.length), ...keys, ...args])
  }
}
