import { RedisLocker } from '@orpc/experimental-lock/redis'
import { createClient } from 'redis'
import { describeRedisCacheStoreContract } from '../../tests/__shared__/redis-store-contract'
import { describeCacheStoreContract } from '../../tests/__shared__/store-contract'
import { RedisCacheStore } from './redis'

const REDIS_URL = process.env.REDIS_URL

describe.concurrent('redis cache store integration', {
  skip: !REDIS_URL,
  timeout: 20_000,
}, async () => {
  const redis = createClient({
    url: REDIS_URL,
  })

  beforeAll(async () => {
    await redis.connect()
  })

  function createTestingStore(options: ConstructorParameters<typeof RedisCacheStore>[1] = {}) {
    const prefix = options.prefix ?? `orpc-redis-cache-store-${crypto.randomUUID()}:`
    return { store: new RedisCacheStore(redis, { ...options, prefix }), prefix }
  }

  describeCacheStoreContract(() => createTestingStore().store)
  describeRedisCacheStoreContract(createTestingStore, {
    exists: key => redis.exists(key),
    type: key => redis.type(key),
    set: (key, value) => redis.set(key, value),
    createLocker: options => new RedisLocker(redis, options),
  })

  it('lazily connects a closed client', async () => {
    const lazyRedis = createClient({ url: REDIS_URL })
    const store = new RedisCacheStore(lazyRedis)

    expect(lazyRedis.isOpen).toBe(false)
    await expect(store.getOrSet(crypto.randomUUID(), async () => 'v')).resolves.toMatchObject({ output: 'v' })
    expect(lazyRedis.isOpen).toBe(true)

    await lazyRedis.destroy()
  })
})
