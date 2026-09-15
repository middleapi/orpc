import { describeCacheStoreContract } from '../tests/__shared__/store-contract'
import { MemoryCacheStore } from './adapters/memory'
import { TieredCacheStore } from './tiered'

describe('tieredCacheStore', () => {
  describeCacheStoreContract(() => new TieredCacheStore([{ store: new MemoryCacheStore() }, { store: new MemoryCacheStore() }]))

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fills front tiers from the next one, and only the last tier from the fill', async () => {
    const front = new MemoryCacheStore()
    const back = new MemoryCacheStore()
    const frontGetOrSet = vi.spyOn(front, 'getOrSet')
    const backGetOrSet = vi.spyOn(back, 'getOrSet')
    const store = new TieredCacheStore([{ store: front }, { store: back }])
    const fill = vi.fn(async () => 'v')

    await back.getOrSet('k', async () => 'from back', { tags: ['t'], ttl: 60_000 })

    await expect(store.getOrSet('k', fill, { tags: ['t'], ttl: 60_000 })).resolves.toMatchObject({ output: 'from back', tags: ['t'], expiresAt: 60_000 })
    expect(fill).not.toHaveBeenCalled()
    expect(backGetOrSet).toHaveBeenCalledTimes(2)

    await expect(store.getOrSet('k', fill, { tags: ['t'], ttl: 60_000 })).resolves.toMatchObject({ output: 'from back' })
    expect(backGetOrSet).toHaveBeenCalledTimes(2)
    expect(frontGetOrSet).toHaveBeenCalledTimes(2)

    await expect(store.getOrSet('miss', fill, { ttl: 60_000 })).resolves.toMatchObject({ output: 'v' })
    expect(fill).toHaveBeenCalledTimes(1)
    await expect(back.getOrSet('miss', async () => 'other')).resolves.toMatchObject({ output: 'v' })
    await expect(front.getOrSet('miss', async () => 'other')).resolves.toMatchObject({ output: 'v' })
  })

  it('caps ttl and swr per tier, refilling a front tier from the next one when its cap passes', async () => {
    const front = new MemoryCacheStore()
    const back = new MemoryCacheStore()
    const store = new TieredCacheStore([{ store: front, ttl: 5000, swr: 0 }, { store: back, ttl: 100_000 }])
    const fill = vi.fn(async () => 'v')

    await expect(store.getOrSet('k', fill, { ttl: 60_000, swr: 30_000 })).resolves.toMatchObject({ expiresAt: 5000, evictAt: 5000 })
    await expect(back.getOrSet('k', fill, { ttl: 60_000, swr: 30_000 })).resolves.toMatchObject({ expiresAt: 60_000, evictAt: 90_000 })

    vi.setSystemTime(6000)
    await expect(store.getOrSet('k', fill, { ttl: 60_000, swr: 30_000 })).resolves.toMatchObject({ output: 'v', expiresAt: 11_000 })
    expect(fill).toHaveBeenCalledTimes(1)

    await expect(store.getOrSet('unbounded', fill)).resolves.toMatchObject({ expiresAt: 11_000, evictAt: 11_000 })
    await expect(back.getOrSet('unbounded', fill)).resolves.toMatchObject({ expiresAt: 106_000, evictAt: 106_000 })
  })

  it('passes waitUntil through to every tier, and revalidates every tier', async () => {
    const front = new MemoryCacheStore()
    const back = new MemoryCacheStore()
    const backRevalidate = vi.spyOn(back, 'revalidate')
    const store = new TieredCacheStore([{ store: front }, { store: back }])

    await store.getOrSet('k', async () => 'v', { tags: ['t'], ttl: 1000, swr: 10_000 })

    vi.setSystemTime(2000)
    const waitUntil = vi.fn()
    await expect(store.getOrSet('k', async () => 'fresh', { tags: ['t'], ttl: 1000, swr: 10_000, waitUntil })).resolves.toMatchObject({ output: 'v' })
    await Promise.all(waitUntil.mock.calls.map(([refresh]) => refresh))
    expect(waitUntil).toHaveBeenCalledTimes(2)
    await expect(back.getOrSet('k', async () => 'other', { tags: ['t'], ttl: 1000, swr: 10_000 })).resolves.toMatchObject({ output: 'fresh' })

    vi.setSystemTime(4000) // the front copy refreshed from a stale back is stale again, and now refills from the fresh one
    await store.getOrSet('k', async () => 'other', { tags: ['t'], ttl: 1000, swr: 10_000, waitUntil })
    await Promise.all(waitUntil.mock.calls.map(([refresh]) => refresh))
    await expect(store.getOrSet('k', async () => 'other', { tags: ['t'], ttl: 1000, swr: 10_000 })).resolves.toMatchObject({ output: 'fresh' })

    await store.revalidate({ tags: ['t'] })
    expect(backRevalidate).toHaveBeenCalledWith({ tags: ['t'] })
    await expect(store.getOrSet('k', async () => 'refilled', { tags: ['t'], ttl: 1000, swr: 10_000 })).resolves.toMatchObject({ output: 'refilled' })
  })
})
