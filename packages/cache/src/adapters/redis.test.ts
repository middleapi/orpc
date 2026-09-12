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
    hset: (key, fields) => redis.hSet(key, fields),
    del: key => redis.del(key),
    scriptFlush: () => redis.scriptFlush(),
  })

  it('reloads a script once the server answers NOSCRIPT for its cached sha', async () => {
    const { store } = createTestingStore()
    const scriptShas = Reflect.get(store, 'scriptShas') as Map<string, string>
    const unknownSha = '0'.repeat(40)

    await store.getOrSet('k', async () => 'v')
    for (const script of scriptShas.keys()) {
      scriptShas.set(script, unknownSha)
    }

    await expect(store.getOrSet('k', async () => 'other')).resolves.toMatchObject({ output: 'v' })
    await expect(store.getOrSet('k2', async () => 'w')).resolves.toMatchObject({ output: 'w' })
    expect([...scriptShas.values()]).not.toContain(unknownSha)
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
