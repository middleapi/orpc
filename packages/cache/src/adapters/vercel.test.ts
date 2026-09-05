import type { RuntimeCache } from '@vercel/functions'
import { RPCSerializer } from '@orpc/client'
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

      await store.set(key, 'v')

      await expect(store.get(key)).resolves.toMatchObject({ output: 'v' })
    })
  })

  describe('locking', () => {
    it('locks per key within the process, handing on after failures', async () => {
      const store = new VercelCacheStore()
      const order: string[] = []
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })

      const first = store.lock('k', async (waited) => {
        order.push(`first:${waited}`)
        await held
      })
      const second = store.lock('k', async (waited) => {
        order.push(`second:${waited}`)
      })
      await expect(store.lock('other', async waited => waited)).resolves.toBe(false)
      expect(order).toEqual(['first:false'])

      release()
      await Promise.all([first, second])
      expect(order).toEqual(['first:false', 'second:true'])

      await expect(store.lock('k', async () => {
        throw new Error('boom')
      })).rejects.toThrow('boom')
      await expect(store.lock('k', async waited => waited)).resolves.toBe(false)
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

      await store.set('k', 'v', { tags: ['t'], ttl: 1, swr: 1 })

      expect(cache.set).toHaveBeenCalledWith('k', expect.objectContaining({ tags: ['t'], expiresAt: 1, evictAt: 2 }), { tags: ['t'], ttl: 2 })
    })

    it('maps a ttl without swr to its exact retention', async () => {
      const cache = createMockedCache()
      const store = new VercelCacheStore({ cache })

      await store.set('k', 'v', { ttl: 1 })

      expect(cache.set).toHaveBeenCalledWith('k', expect.objectContaining({ expiresAt: 1, evictAt: 1 }), { ttl: 1 })
    })

    it('omits ttl and tags options when unset', async () => {
      const cache = createMockedCache()
      const store = new VercelCacheStore({ cache })

      await store.set('k', 'v')

      expect(cache.set).toHaveBeenCalledWith('k', expect.objectContaining({ tags: undefined }), {})
    })

    it('returns stale entries within the swr window, then evicts defensively', async () => {
      const cache = createMockedCache()
      const store = new VercelCacheStore({ cache })

      await store.set('k', 'v', { ttl: 1, swr: 1 })

      vi.setSystemTime(1200) // past ttl, within swr
      await expect(store.get('k')).resolves.toEqual({ output: 'v', tags: undefined, expiresAt: 1 })

      vi.setSystemTime(2000) // past ttl + swr, backend has not evicted yet
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
