import { RPCJsonSerializer } from '@orpc/client'
import { Cacheable, Keyv } from 'cacheable'
import { describeCacheStoreContract } from '../../tests/__shared__/store-contract'
import { CacheableCacheStore } from './cacheable'

describe('cacheableCacheStore', () => {
  describe('against the memory primary', () => {
    describeCacheStoreContract(() => new CacheableCacheStore(new Cacheable()))
  })

  describe('against a primary with a Keyv secondary', () => {
    describeCacheStoreContract(() => new CacheableCacheStore(new Cacheable({ secondary: new Keyv() })))
  })

  it('enables the tag service, and revalidates through it', async () => {
    const cacheable = new Cacheable()
    expect(cacheable.tags.enabled).toBe(false)
    const invalidateTags = vi.spyOn(cacheable.tags, 'invalidateTags')
    const store = new CacheableCacheStore(cacheable)

    expect(cacheable.tags.enabled).toBe(true)

    await store.revalidate({ tags: ['a', 'b'] })
    expect(invalidateTags).toHaveBeenCalledWith(['a', 'b'])
  })

  it('maps ttl + swr to a retention in milliseconds, and passes tags on', async () => {
    const cacheable = new Cacheable()
    const set = vi.spyOn(cacheable, 'set')
    const store = new CacheableCacheStore(cacheable)

    await store.getOrSet('k', async () => 'v', { tags: ['t'], ttl: 1000, swr: 1000 })
    expect(set).toHaveBeenCalledWith('k', expect.objectContaining({ tags: ['t'] }), { tags: ['t'], ttl: 2000 })

    await store.getOrSet('forever', async () => 'v')
    expect(set).toHaveBeenCalledWith('forever', expect.objectContaining({ tags: undefined }), {})
  })

  it('evicts defensively when the backend still holds an entry past evictAt', async () => {
    const cacheable = new Cacheable()
    const store = new CacheableCacheStore(cacheable)
    await store.getOrSet('k', async () => 'v')

    vi.spyOn(cacheable, 'get').mockResolvedValueOnce({ output: { json: 'v' }, expiresAt: 1, evictAt: 1 })

    await expect(store.getOrSet('k', async () => 'refilled')).resolves.toMatchObject({ output: 'refilled' })
  })

  it('supports a custom serializer', async () => {
    const serializer = new RPCJsonSerializer()
    const serializeSpy = vi.spyOn(serializer, 'serialize')
    const deserializeSpy = vi.spyOn(serializer, 'deserialize')
    const store = new CacheableCacheStore(new Cacheable(), { serializer })

    await store.getOrSet('k', async () => ({ date: new Date(1) }))

    await expect(store.getOrSet('k', async () => 'other')).resolves.toMatchObject({ output: { date: new Date(1) } })
    expect(serializeSpy).toHaveBeenCalled()
    expect(deserializeSpy).toHaveBeenCalled()
  })
})
