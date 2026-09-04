import { RPCSerializer } from '@orpc/client'
import { nowInSeconds, sleep } from '@orpc/shared'
import { createClient } from 'redis'
import { describeCacheStoreContract } from '../../tests/__shared__/store-contract'
import { holdResult } from '../../tests/__shared__/utils'
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
    options: ConstructorParameters<typeof RedisCacheStore>[1] = {},
  ) {
    const prefix = `orpc-redis-cache-store-${crypto.randomUUID()}:`
    return { store: new RedisCacheStore(redis, { prefix, ...options }), prefix }
  }

  describeCacheStoreContract(() => createTestingStore().store)

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

    await store.set('no-swr', 'v', { ttl: 1 })
    await store.set('swr', 'v', { ttl: 1, swr: 10 })

    await sleep(1500)

    await expect(store.get('no-swr')).resolves.toBeUndefined()

    const stale = await store.get('swr')
    expect(stale!.output).toBe('v')
    expect(stale!.expiresAt).toBeLessThanOrEqual(nowInSeconds())
  })

  it('stores entries and tag counters under the prefixed key families', async () => {
    const { store, prefix } = createTestingStore()

    await store.set('k', 'v', { tags: ['t'] })
    await store.revalidate({ tags: ['t'] })

    await expect(redis.exists(`${prefix}e:k`)).resolves.toBe(1)
    await expect(redis.exists(`${prefix}t:t`)).resolves.toBe(1)
  })

  it('lazily connects a closed client', async () => {
    const lazyRedis = createClient({ url: REDIS_URL })
    const store = new RedisCacheStore(lazyRedis, { prefix: `orpc-redis-cache-store-${crypto.randomUUID()}:` })

    expect(lazyRedis.isOpen).toBe(false)
    await expect(store.get('unknown')).resolves.toBeUndefined()
    expect(lazyRedis.isOpen).toBe(true)

    await lazyRedis.destroy()
  })

  it('stays consistent under concurrent sets, gets, and a revalidation on a shared tag', async () => {
    const { store } = createTestingStore()
    const keys = Array.from({ length: 20 }, (_, index) => `k${index}`)

    await Promise.all([
      ...keys.map(key => store.set(key, key, { tags: ['t'] })),
      store.revalidate({ tags: ['t'] }),
      ...keys.map(key => store.get(key)),
    ])

    // Entries snapshotted before the revalidation miss, the rest hit with their own output.
    const entries = await Promise.all(keys.map(key => store.get(key)))
    entries.forEach((entry, index) => {
      if (entry !== undefined) {
        expect(entry.output).toBe(keys[index])
      }
    })

    await store.revalidate({ tags: ['t'] })

    await expect(Promise.all(keys.map(key => store.get(key)))).resolves.toEqual(keys.map(() => undefined))
  })
})

describe('redis cache store with a mocked client', () => {
  /**
   * A Map-backed stand-in for the commands the store uses, so tests can
   * interleave real operations while still asserting the issued commands.
   */
  function createMockedRedis() {
    const data = new Map<string, string>()
    const queued: string[] = []

    const incr = (key: string) => {
      const next = Number(data.get(key) ?? 0) + 1
      data.set(key, String(next))
      return next
    }

    const multi = {
      incr: vi.fn((key: string) => {
        queued.push(key)
        return multi
      }),
      exec: vi.fn(async () => queued.splice(0).map(incr)),
    }

    const redis = {
      isOpen: true,
      connect: vi.fn(async () => {
        redis.isOpen = true
      }),
      get: vi.fn(async (key: string): Promise<string | null> => data.get(key) ?? null),
      set: vi.fn(async (key: string, value: string, _options?: unknown) => {
        data.set(key, value)
        return 'OK'
      }),
      del: vi.fn(async (key: string) => (data.delete(key) ? 1 : 0)),
      incr: vi.fn(async (key: string) => incr(key)),
      mGet: vi.fn(async (keys: string[]): Promise<(string | null)[]> => keys.map(key => data.get(key) ?? null)),
      multi: vi.fn(() => multi),
    }

    return { redis, multi }
  }

  function createMockedStore() {
    const { redis, multi } = createMockedRedis()
    return { store: new RedisCacheStore(redis as any, { prefix: 'p:' }), redis, multi }
  }

  it('misses on unknown keys without connecting an open client', async () => {
    const { store, redis } = createMockedStore()

    await expect(store.get('k')).resolves.toBeUndefined()

    expect(redis.get).toHaveBeenCalledWith('p:e:k')
    expect(redis.connect).not.toHaveBeenCalled()
  })

  it('lazily connects a closed client', async () => {
    const { store, redis } = createMockedStore()
    redis.isOpen = false

    await store.get('k')

    expect(redis.connect).toHaveBeenCalledTimes(1)
  })

  it('stores envelopes with snapshotted tag versions and EX retention', async () => {
    const { store, redis } = createMockedStore()
    redis.mGet.mockResolvedValueOnce(['2'])

    await store.set('k', { a: 1 }, { tags: ['t'], ttl: 1, swr: 1 })

    expect(redis.mGet).toHaveBeenCalledWith(['p:t:t'])
    expect(redis.set).toHaveBeenCalledWith(
      'p:e:k',
      expect.stringContaining('"tagVersions":{"t":2}'),
      { expiration: { type: 'EX', value: 2 } },
    )
  })

  it('stores untagged entries without expiration or tag reads', async () => {
    const { store, redis } = createMockedStore()

    await store.set('k', 'v')

    expect(redis.mGet).not.toHaveBeenCalled()
    expect(redis.set).toHaveBeenCalledWith('p:e:k', expect.any(String), undefined)
  })

  it('round-trips stored envelopes, skipping tag reads for untagged entries', async () => {
    const { store, redis } = createMockedStore()

    await store.set('k', { a: 1 })

    await expect(store.get('k')).resolves.toEqual({ output: { a: 1 }, tags: undefined, expiresAt: undefined })
    expect(redis.mGet).not.toHaveBeenCalled()
  })

  it('returns entries whose tag versions still match', async () => {
    const { store } = createMockedStore()

    await store.revalidate({ tags: ['t'] })
    await store.revalidate({ tags: ['t'] })
    await store.set('k', 'v', { tags: ['t'], ttl: 1 })

    const entry = await store.get('k')
    expect(entry!.output).toBe('v')
    expect(entry!.tags).toEqual(['t'])
    expect(entry!.expiresAt).toBeGreaterThan(0)
  })

  it('deletes and misses entries whose tag versions changed', async () => {
    const { store, redis } = createMockedStore()

    await store.set('k', 'v', { tags: ['t'] })
    await store.revalidate({ tags: ['t'] })

    await expect(store.get('k')).resolves.toBeUndefined()
    expect(redis.del).toHaveBeenCalledWith('p:e:k')
  })

  it('drops an entry whose tag versions were read before a racing revalidation', async () => {
    const { redis } = createMockedRedis()
    const { client, read, release } = holdResult(redis, 'mGet')
    const store = new RedisCacheStore(client as any, { prefix: 'p:' })

    const set = store.set('k', 'v', { tags: ['t'] }) // entry written after release
    await read // versions are read by now
    await store.revalidate({ tags: ['t'] })
    release()
    await set

    expect(redis.set).toHaveBeenCalledWith('p:e:k', expect.stringContaining('"tagVersions":{"t":0}'), undefined)
    await expect(store.get('k')).resolves.toBeUndefined()
    expect(redis.del).toHaveBeenCalledWith('p:e:k')
  })

  it('revalidates a single tag with one INCR, and many atomically', async () => {
    const { store, redis, multi } = createMockedStore()

    await store.revalidate({ tags: ['t'] })
    expect(redis.incr).toHaveBeenCalledWith('p:t:t')

    await store.revalidate({ tags: ['a', 'b'] })
    expect(multi.incr).toHaveBeenCalledWith('p:t:a')
    expect(multi.incr).toHaveBeenCalledWith('p:t:b')
    expect(multi.exec).toHaveBeenCalledTimes(1)
  })

  it('supports a custom serializer and treats missing tag counters as zero', async () => {
    const serializer = new RPCSerializer()
    const serializeSpy = vi.spyOn(serializer, 'serialize')
    const { redis } = createMockedRedis()
    const store = new RedisCacheStore(redis as any)

    await store.set('k', 'v', { tags: ['t'], ttl: 1 })

    expect(redis.set).toHaveBeenCalledWith(
      'e:k',
      expect.stringContaining('"tagVersions":{"t":0}'),
      { expiration: { type: 'EX', value: 1 } },
    )

    const customStore = new RedisCacheStore(redis as any, { serializer })

    await expect(customStore.get('k')).resolves.toMatchObject({ output: 'v' })
    expect(serializeSpy).not.toHaveBeenCalled() // only used for writes and key encoding
  })

  it('treats tags missing from the snapshot as version zero', async () => {
    const { store, redis } = createMockedStore()

    redis.get.mockResolvedValueOnce(JSON.stringify({ output: { json: 'v' }, tags: ['t'], tagVersions: {} }))

    await expect(store.get('k')).resolves.toMatchObject({ output: 'v' })
  })

  it('encodes non-string keys stably', async () => {
    const { store, redis } = createMockedStore()

    await store.get([['planet', 'find'], { b: 2, a: 1 }])
    await store.get([['planet', 'find'], { a: 1, b: 2 }])

    expect(redis.get.mock.calls[0]![0]).toBe(redis.get.mock.calls[1]![0])
    expect(redis.get.mock.calls[0]![0]).toMatch(/^p:e:\[/)
  })
})
