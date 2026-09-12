import type { RuntimeCache } from '@vercel/functions'
import { RPCJsonSerializer } from '@orpc/client'
import { getCache } from '@vercel/functions'
import { describeCacheStoreContract } from '../../tests/__shared__/store-contract'
import { VercelCacheStore } from './vercel'

describe('vercelCacheStore', () => {
  describe('against the in-memory getCache fallback', () => {
    function createTestingStore() {
      return new VercelCacheStore({
        cache: getCache({ namespace: crypto.randomUUID() }),
      })
    }

    describeCacheStoreContract(createTestingStore)

    it('defaults to getCache when no cache is given', async () => {
      const store = new VercelCacheStore()
      const key = crypto.randomUUID()

      await store.getOrSet(key, async () => 'v')

      await expect(store.getOrSet(key, async () => 'other')).resolves.toMatchObject({ output: 'v' })
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

    it('maps ttl + swr to the retention it passes on', async () => {
      const cache = createMockedCache()
      const store = new VercelCacheStore({ cache })

      await store.getOrSet('k', async () => 'v', { tags: ['t'], ttl: 1, swr: 1 })

      expect(cache.set).toHaveBeenCalledWith('k', expect.objectContaining({ tags: ['t'], expiresAt: 1, evictAt: 2 }), { tags: ['t'], ttl: 2 })
    })

    it('maps a ttl without swr to its exact retention', async () => {
      const cache = createMockedCache()
      const store = new VercelCacheStore({ cache })

      await store.getOrSet('k', async () => 'v', { ttl: 1 })

      expect(cache.set).toHaveBeenCalledWith('k', expect.objectContaining({ expiresAt: 1, evictAt: 1 }), { ttl: 1 })
    })

    it('omits ttl and tags options when unset', async () => {
      const cache = createMockedCache()
      const store = new VercelCacheStore({ cache })

      await store.getOrSet('k', async () => 'v')

      expect(cache.set).toHaveBeenCalledWith('k', expect.objectContaining({ tags: undefined }), {})
    })

    it('serves stale entries within the swr window, refreshes through waitUntil, and evicts defensively', async () => {
      const cache = createMockedCache()
      const store = new VercelCacheStore({ cache })

      await store.getOrSet('k', async () => 'v', { ttl: 1, swr: 1 })

      vi.setSystemTime(1200) // past ttl, within swr
      const waitUntil = vi.fn()
      await expect(store.getOrSet('k', async () => {
        throw new Error('handler down')
      }, { ttl: 1, swr: 1, waitUntil })).resolves.toEqual({ output: 'v', tags: undefined, expiresAt: 1, evictAt: 2 })
      await expect(waitUntil.mock.calls[0]![0]).rejects.toThrow('handler down')

      vi.setSystemTime(2000) // past ttl + swr, backend has not evicted yet
      await expect(store.getOrSet('k', async () => 'refilled', { ttl: 1, swr: 1 })).resolves.toMatchObject({ output: 'refilled' })
      expect(cache.delete).toHaveBeenCalledWith('k')
    })

    it('refreshes once for concurrent stale hits, and again when the first refresh failed', async () => {
      const cache = createMockedCache()
      const store = new VercelCacheStore({ cache })
      await store.getOrSet('k', async () => 'v', { ttl: 1, swr: 1 })

      vi.setSystemTime(1200)
      let finish!: (output: string) => void
      const fill = vi.fn(() => new Promise<string>((resolve) => {
        finish = resolve
      }))
      const waitUntil = vi.fn()

      await store.getOrSet('k', fill, { ttl: 1, swr: 1, waitUntil })
      await store.getOrSet('k', fill, { ttl: 1, swr: 1, waitUntil })
      finish('fresh')
      await Promise.all(waitUntil.mock.calls.map(([refresh]) => refresh))
      expect(fill).toHaveBeenCalledTimes(1)
      await expect(store.getOrSet('k', fill, { ttl: 1, swr: 1 })).resolves.toMatchObject({ output: 'fresh' })

      vi.setSystemTime(2400) // stale again
      let fail!: (error: Error) => void
      const failingFill = vi.fn()
        .mockImplementationOnce(() => new Promise<never>((_, reject) => {
          fail = reject
        }))
        .mockResolvedValue('fresher')
      const waitUntilAgain = vi.fn()

      await store.getOrSet('k', failingFill, { ttl: 1, swr: 1, waitUntil: waitUntilAgain })
      await store.getOrSet('k', failingFill, { ttl: 1, swr: 1, waitUntil: waitUntilAgain })
      fail(new Error('handler down'))

      await expect(waitUntilAgain.mock.calls[0]![0]).rejects.toThrow('handler down')
      await waitUntilAgain.mock.calls[1]![0]
      expect(failingFill).toHaveBeenCalledTimes(2)
      await expect(store.getOrSet('k', failingFill, { ttl: 1, swr: 1 })).resolves.toMatchObject({ output: 'fresher' })
    })

    it('supports a custom serializer', async () => {
      const cache = createMockedCache()
      const serializer = new RPCJsonSerializer()
      const serializeSpy = vi.spyOn(serializer, 'serialize')
      const deserializeSpy = vi.spyOn(serializer, 'deserialize')
      const store = new VercelCacheStore({ cache, serializer })

      await store.getOrSet('k', async () => ({ a: 1 }))

      await expect(store.getOrSet('k', async () => 'other')).resolves.toMatchObject({ output: { a: 1 } })
      expect(serializeSpy).toHaveBeenCalled()
      expect(deserializeSpy).toHaveBeenCalled()
    })
  })
})
