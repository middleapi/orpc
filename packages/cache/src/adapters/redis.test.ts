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

describe('redis cache store with a mocked client', () => {
  function createMockedRedis() {
    const multi = {
      incr: vi.fn(() => multi),
      exec: vi.fn(async () => []),
    }

    const redis = {
      isOpen: true,
      connect: vi.fn(async () => {
        redis.isOpen = true
      }),
      get: vi.fn(async (_key: string): Promise<string | null> => null),
      set: vi.fn(async (_key: string, _value: string, _options?: unknown) => 'OK'),
      del: vi.fn(async (_key: string) => 1),
      incr: vi.fn(async (_key: string) => 1),
      mGet: vi.fn(async (_keys: string[]): Promise<(string | null)[]> => []),
      multi: vi.fn(() => multi),
    }

    return { redis, multi }
  }

  function createMockedStore() {
    const { redis, multi } = createMockedRedis()
    return { store: new RedisCacheStore({ redis: redis as any, prefix: 'p:' }), redis, multi }
  }

  it('misses on unknown keys without connecting an open client', async () => {
    const { store, redis } = createMockedStore()

    await expect(store.get('k')).resolves.toBeUndefined()

    expect(redis.get).toHaveBeenCalledWith('p:entry:k')
    expect(redis.connect).not.toHaveBeenCalled()
  })

  it('lazily connects a closed client', async () => {
    const { store, redis } = createMockedStore()
    redis.isOpen = false

    await store.get('k')

    expect(redis.connect).toHaveBeenCalledTimes(1)
  })

  it('stores envelopes with snapshotted tag versions and PX retention', async () => {
    const { store, redis } = createMockedStore()
    redis.mGet.mockResolvedValueOnce(['2'])

    await store.set('k', { a: 1 }, { tags: ['t'], ttl: 1000, swr: 500 })

    expect(redis.mGet).toHaveBeenCalledWith(['p:tag:t'])
    expect(redis.set).toHaveBeenCalledWith(
      'p:entry:k',
      expect.stringContaining('"tagVersions":{"t":2}'),
      { expiration: { type: 'PX', value: 1500 } },
    )
  })

  it('stores untagged entries without expiration or tag reads', async () => {
    const { store, redis } = createMockedStore()

    await store.set('k', 'v')

    expect(redis.mGet).not.toHaveBeenCalled()
    expect(redis.set).toHaveBeenCalledWith('p:entry:k', expect.any(String), undefined)
  })

  it('ignores outputs containing blobs', async () => {
    const { store, redis } = createMockedStore()

    await store.set('k', { file: new Blob(['x']) })

    expect(redis.set).not.toHaveBeenCalled()
  })

  it('round-trips stored envelopes, skipping tag reads for untagged entries', async () => {
    const { store, redis } = createMockedStore()

    await store.set('k', { a: 1 })
    redis.get.mockResolvedValueOnce(redis.set.mock.calls[0]![1])

    await expect(store.get('k')).resolves.toEqual({ output: { a: 1 }, tags: [], expiresAt: undefined })
    expect(redis.mGet).not.toHaveBeenCalled()
  })

  it('returns entries whose tag versions still match', async () => {
    const { store, redis } = createMockedStore()
    redis.mGet.mockResolvedValue(['2'])

    await store.set('k', 'v', { tags: ['t'], ttl: 1000 })
    redis.get.mockResolvedValueOnce(redis.set.mock.calls[0]![1])

    const entry = await store.get('k')
    expect(entry!.output).toBe('v')
    expect(entry!.tags).toEqual(['t'])
    expect(entry!.expiresAt).toBeGreaterThan(0)
  })

  it('deletes and misses entries whose tag versions changed', async () => {
    const { store, redis } = createMockedStore()
    redis.mGet.mockResolvedValueOnce(['2'])

    await store.set('k', 'v', { tags: ['t'] })
    redis.get.mockResolvedValueOnce(redis.set.mock.calls[0]![1])
    redis.mGet.mockResolvedValueOnce(['3']) // revalidated since the snapshot

    await expect(store.get('k')).resolves.toBeUndefined()
    expect(redis.del).toHaveBeenCalledWith('p:entry:k')
  })

  it('revalidates a single tag with one INCR, and many atomically', async () => {
    const { store, redis, multi } = createMockedStore()

    await store.revalidateTag('t')
    expect(redis.incr).toHaveBeenCalledWith('p:tag:t')

    await store.revalidateTag(['a', 'b'])
    expect(multi.incr).toHaveBeenCalledWith('p:tag:a')
    expect(multi.incr).toHaveBeenCalledWith('p:tag:b')
    expect(multi.exec).toHaveBeenCalledTimes(1)

    await store.revalidateTag([])
    expect(redis.incr).toHaveBeenCalledTimes(1)
    expect(multi.exec).toHaveBeenCalledTimes(1)
  })

  it('supports a custom serializer and treats missing tag counters as zero', async () => {
    const serializer = new RPCSerializer()
    const serializeSpy = vi.spyOn(serializer, 'serialize')
    const { redis } = createMockedRedis()
    const store = new RedisCacheStore({ redis: redis as any })

    redis.mGet.mockResolvedValueOnce([null])
    await store.set('k', 'v', { tags: ['t'], ttl: 1000 })

    expect(redis.set).toHaveBeenCalledWith(
      'entry:k',
      expect.stringContaining('"tagVersions":{"t":0}'),
      { expiration: { type: 'PX', value: 1000 } },
    )

    const customStore = new RedisCacheStore({ redis: redis as any, serializer })
    redis.get.mockResolvedValueOnce(redis.set.mock.calls[0]![1])
    redis.mGet.mockResolvedValueOnce([null]) // still matches the zero snapshot

    await expect(customStore.get('k')).resolves.toMatchObject({ output: 'v' })
    expect(serializeSpy).not.toHaveBeenCalled() // only used for writes and key encoding
  })

  it('treats tags missing from the snapshot as version zero', async () => {
    const { store, redis } = createMockedStore()

    redis.get.mockResolvedValueOnce(JSON.stringify({ output: { json: 'v' }, tags: ['t'], tagVersions: {} }))
    redis.mGet.mockResolvedValueOnce([null])

    await expect(store.get('k')).resolves.toMatchObject({ output: 'v' })
  })

  it('encodes non-string keys stably', async () => {
    const { store, redis } = createMockedStore()

    await store.get([['planet', 'find'], { b: 2, a: 1 }])
    await store.get([['planet', 'find'], { a: 1, b: 2 }])

    expect(redis.get.mock.calls[0]![0]).toBe(redis.get.mock.calls[1]![0])
    expect(redis.get.mock.calls[0]![0]).toMatch(/^p:entry:\[/)
  })
})
