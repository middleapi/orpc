import { RPCSerializer } from '@orpc/client'
import { sleep } from '@orpc/shared'
import { createClient } from 'redis'
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

  function createTestingStore(
    options: Partial<ConstructorParameters<typeof RedisCacheStore>[0]> = {},
  ) {
    const prefix = `orpc-redis-cache-store-${crypto.randomUUID()}:`
    return { store: new RedisCacheStore({ redis, prefix, ...options }), prefix }
  }

  it('round-trips outputs with tags and expiresAt', async () => {
    const { store } = createTestingStore()

    await store.set('k', { nested: [1, 2] }, { tags: ['t'], ttl: 10_000 })

    const entry = await store.get('k')
    expect(entry!.output).toEqual({ nested: [1, 2] })
    expect(entry!.tags).toEqual(['t'])
    expect(entry!.expiresAt).toBeGreaterThan(Date.now())
  })

  it('misses on unknown keys', async () => {
    const { store } = createTestingStore()

    await expect(store.get('unknown')).resolves.toBeUndefined()
  })

  it('preserves Date, Map, Set, and BigInt outputs', async () => {
    const { store } = createTestingStore()
    const output = {
      date: new Date('2026-01-02T03:04:05.678Z'),
      map: new Map([['a', 1]]),
      set: new Set([1, 2]),
      big: 123n,
    }

    await store.set('k', output)

    await expect(store.get('k')).resolves.toMatchObject({ output })
  })

  it('ignores outputs containing blobs', async () => {
    const { store } = createTestingStore()

    await store.set('k', { file: new Blob(['x']) })

    await expect(store.get('k')).resolves.toBeUndefined()
  })

  it('supports a custom serializer', async () => {
    const serializer = new RPCSerializer()
    const serializeSpy = vi.spyOn(serializer, 'serialize')
    const deserializeSpy = vi.spyOn(serializer, 'deserialize')
    const { store } = createTestingStore({ serializer })

    await store.set('k', { a: 1 })

    await expect(store.get('k')).resolves.toMatchObject({ output: { a: 1 } })
    expect(serializeSpy).toHaveBeenCalled()
    expect(deserializeSpy).toHaveBeenCalled()
  })

  it('evicts at ttl without swr, and serves stale within the swr window', async () => {
    const { store } = createTestingStore()

    await store.set('no-swr', 'v', { ttl: 300 })
    await store.set('swr', 'v', { ttl: 300, swr: 10_000 })

    await sleep(500)

    await expect(store.get('no-swr')).resolves.toBeUndefined()

    const stale = await store.get('swr')
    expect(stale!.output).toBe('v')
    expect(stale!.expiresAt).toBeLessThanOrEqual(Date.now())
  })

  it('invalidates entries by any of their tags', async () => {
    const { store } = createTestingStore()

    await store.set('multi', 'v', { tags: ['a', 'b'] })
    await store.set('other', 'v', { tags: ['c'] })

    await store.revalidateTag('a')

    await expect(store.get('multi')).resolves.toBeUndefined()
    await expect(store.get('other')).resolves.toBeDefined()
  })

  it('revalidates many tags at once', async () => {
    const { store } = createTestingStore()

    await store.set('a', 'v', { tags: ['a'] })
    await store.set('b', 'v', { tags: ['b'] })

    await store.revalidateTag(['a', 'b'])

    await expect(store.get('a')).resolves.toBeUndefined()
    await expect(store.get('b')).resolves.toBeUndefined()
  })

  it('entries set after a revalidation remain valid', async () => {
    const { store } = createTestingStore()

    await store.set('k', 'old', { tags: ['t'] })
    await store.revalidateTag('t')
    await store.set('k', 'new', { tags: ['t'] })

    await expect(store.get('k')).resolves.toMatchObject({ output: 'new' })
  })

  it('stores entries and tag counters under the prefixed key families', async () => {
    const { store, prefix } = createTestingStore()

    await store.set('k', 'v', { tags: ['t'] })
    await store.revalidateTag('t')

    await expect(redis.exists(`${prefix}entry:k`)).resolves.toBe(1)
    await expect(redis.exists(`${prefix}tag:t`)).resolves.toBe(1)
  })

  it('lazily connects a closed client', async () => {
    const lazyRedis = createClient({ url: REDIS_URL })
    const store = new RedisCacheStore({ redis: lazyRedis, prefix: `orpc-redis-cache-store-${crypto.randomUUID()}:` })

    expect(lazyRedis.isOpen).toBe(false)
    await expect(store.get('unknown')).resolves.toBeUndefined()
    expect(lazyRedis.isOpen).toBe(true)

    await lazyRedis.destroy()
  })
})
