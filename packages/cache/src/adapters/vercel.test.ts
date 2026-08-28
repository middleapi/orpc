import type { RuntimeCache } from '@vercel/functions'
import { RPCSerializer } from '@orpc/client'
import { getCache } from '@vercel/functions'
import { VercelCacheStore } from './vercel'

describe('vercelCacheStore', () => {
  describe('against the in-memory getCache fallback', () => {
    function createTestingStore() {
      return new VercelCacheStore({
        cache: getCache({ namespace: crypto.randomUUID() }),
      })
    }

    it('round-trips outputs with tags, including undefined', async () => {
      const store = createTestingStore()

      await store.set('k', { nested: [1, 2] }, { tags: ['t'] })
      await expect(store.get('k')).resolves.toEqual({ output: { nested: [1, 2] }, tags: ['t'], expiresAt: undefined })

      await store.set('u', undefined)
      await expect(store.get('u')).resolves.toEqual({ output: undefined, tags: [], expiresAt: undefined })
    })

    it('misses on unknown keys', async () => {
      const store = createTestingStore()

      await expect(store.get('unknown')).resolves.toBeUndefined()
    })

    it('preserves Date, Map, Set, and BigInt outputs', async () => {
      const store = createTestingStore()
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
      const store = createTestingStore()

      await store.set('k', { file: new Blob(['x']) })

      await expect(store.get('k')).resolves.toBeUndefined()
    })

    it('invalidates entries by any of their tags via expireTag', async () => {
      const store = createTestingStore()

      await store.set('multi', 'v', { tags: ['a', 'b'] })
      await store.set('other', 'v', { tags: ['c'] })

      await store.revalidateTag('a')

      await expect(store.get('multi')).resolves.toBeUndefined()
      await expect(store.get('other')).resolves.toBeDefined()
    })

    it('revalidates many tags at once', async () => {
      const store = createTestingStore()

      await store.set('a', 'v', { tags: ['a'] })
      await store.set('b', 'v', { tags: ['b'] })

      await store.revalidateTag(['a', 'b'])

      await expect(store.get('a')).resolves.toBeUndefined()
      await expect(store.get('b')).resolves.toBeUndefined()
    })

    it('defaults to getCache when no cache is given', async () => {
      const store = new VercelCacheStore()
      const key = crypto.randomUUID()

      await store.set(key, 'v')

      await expect(store.get(key)).resolves.toMatchObject({ output: 'v' })
    })

    it('skips purging when no tags are given', async () => {
      const store = createTestingStore()

      await store.set('k', 'v', { tags: ['t'] })
      await store.revalidateTag([])

      await expect(store.get('k')).resolves.toBeDefined()
    })
  })

  describe('against a mocked runtime cache', () => {
    function createMockedCache() {
      const values = new Map<string, unknown>()

      const cache = {
        get: vi.fn(async (key: string) => values.get(key) ?? null),
        set: vi.fn(async (key: string, value: unknown) => {
          values.set(key, value)
        }),
        delete: vi.fn(async (key: string) => {
          values.delete(key)
        }),
        expireTag: vi.fn(async () => {}),
      } satisfies RuntimeCache

      return cache
    }

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(0)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('maps ttl + swr to whole-second retention', async () => {
      const cache = createMockedCache()
      const store = new VercelCacheStore({ cache })

      await store.set('k', 'v', { tags: ['t'], ttl: 1000, swr: 500 })

      expect(cache.set).toHaveBeenCalledWith('k', expect.objectContaining({ tags: ['t'], expiresAt: 1000, evictAt: 1500 }), { tags: ['t'], ttl: 2 })
    })

    it('maps a ttl without swr to its exact retention', async () => {
      const cache = createMockedCache()
      const store = new VercelCacheStore({ cache })

      await store.set('k', 'v', { ttl: 1000 })

      expect(cache.set).toHaveBeenCalledWith('k', expect.objectContaining({ expiresAt: 1000, evictAt: 1000 }), { ttl: 1 })
    })

    it('omits ttl and tags options when unset', async () => {
      const cache = createMockedCache()
      const store = new VercelCacheStore({ cache })

      await store.set('k', 'v')

      expect(cache.set).toHaveBeenCalledWith('k', expect.objectContaining({ tags: [] }), {})
    })

    it('returns stale entries within the swr window, then evicts defensively', async () => {
      const cache = createMockedCache()
      const store = new VercelCacheStore({ cache })

      await store.set('k', 'v', { ttl: 1000, swr: 500 })

      vi.setSystemTime(1200) // past ttl, within swr
      await expect(store.get('k')).resolves.toEqual({ output: 'v', tags: [], expiresAt: 1000 })

      vi.setSystemTime(1500) // past ttl + swr, backend has not evicted yet
      await expect(store.get('k')).resolves.toBeUndefined()
      expect(cache.delete).toHaveBeenCalledWith('k')
    })

    it('supports a custom serializer', async () => {
      const cache = createMockedCache()
      const serializer = new RPCSerializer()
      const serializeSpy = vi.spyOn(serializer, 'serialize')
      const deserializeSpy = vi.spyOn(serializer, 'deserialize')
      const store = new VercelCacheStore({ cache, serializer })

      await store.set('k', { a: 1 })

      await expect(store.get('k')).resolves.toMatchObject({ output: { a: 1 } })
      expect(serializeSpy).toHaveBeenCalled()
      expect(deserializeSpy).toHaveBeenCalled()
    })
  })
})
