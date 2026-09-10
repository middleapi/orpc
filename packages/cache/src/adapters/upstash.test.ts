import { nowInSeconds } from '@orpc/shared'
import { Redis } from '@upstash/redis'
import { describeRedisCacheStoreContract } from '../../tests/__shared__/redis-store-contract'
import { describeCacheStoreContract } from '../../tests/__shared__/store-contract'
import { UpstashCacheStore } from './upstash'

const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

/**
 * These tests depend on a real Upstash redis server — make sure to set the
 * `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` envs.
 */
describe.concurrent('upstash cache store integration', {
  // TODO: Upstash is not compatible with Node 26 yet — temporarily disable these tests and revisit in the future.
  skip: !UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN || process.versions.node.startsWith('26.'),
  timeout: 20_000,
}, () => {
  const redis = new Redis({
    url: UPSTASH_REDIS_REST_URL,
    token: UPSTASH_REDIS_REST_TOKEN,
  })

  function createTestingStore(options: ConstructorParameters<typeof UpstashCacheStore>[1] = {}, client = redis) {
    const prefix = options.prefix ?? `orpc-upstash-cache-store-${crypto.randomUUID()}:`
    return { store: new UpstashCacheStore(client, { ...options, prefix }), prefix }
  }

  describeCacheStoreContract(() => createTestingStore().store)
  describeRedisCacheStoreContract(createTestingStore, {
    exists: key => redis.exists(key),
    type: key => redis.type(key),
    hset: (key, fields) => redis.hset(key, fields),
    scriptFlush: () => redis.scriptFlush(),
  })

  it('reads entries when the client does not parse JSON replies', async () => {
    const rawRedis = new Redis({
      url: UPSTASH_REDIS_REST_URL,
      token: UPSTASH_REDIS_REST_TOKEN,
      automaticDeserialization: false,
    })
    const { store } = createTestingStore({}, rawRedis)

    await store.getOrSet('k', async () => ({ a: 1 }), { tags: ['t'], ttl: 60 })

    const entry = await store.getOrSet('k', async () => 'other', { tags: ['t'], ttl: 60 })
    expect(entry.output).toEqual({ a: 1 })
    expect(entry.tags).toEqual(['t'])
    expect(entry.expiresAt).toBeGreaterThan(nowInSeconds())

    await store.revalidate({ tags: ['t'] })
    await expect(store.getOrSet('k', async () => 'refilled', { tags: ['t'] })).resolves.toMatchObject({ output: 'refilled' })
  })
})
