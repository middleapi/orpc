import { RPCJsonSerializer } from '@orpc/client'
import { describeCacheStoreContract } from '../../tests/__shared__/store-contract'
import { MemoryCacheStore } from './memory'

describe('memoryCacheStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describeCacheStoreContract(() => new MemoryCacheStore())

  it('encodes structurally equal non-string keys to the same entry', async () => {
    const store = new MemoryCacheStore()

    await store.set([['planet', 'find'], { b: 2, a: 1 }], 'v')

    await expect(store.get([['planet', 'find'], { a: 1, b: 2 }])).resolves.toMatchObject({ output: 'v' })
    await expect(store.get([['planet', 'find'], { a: 1, b: 3 }])).resolves.toBeUndefined()
    await expect(store.get([['planet', 'list'], { a: 1, b: 2 }])).resolves.toBeUndefined()
  })

  it('encodes complex key values, ignoring unsupported ones like blobs', async () => {
    const store = new MemoryCacheStore()

    await store.set({ date: new Date(1), big: 1n }, 'v')
    await expect(store.get({ big: 1n, date: new Date(1) })).resolves.toMatchObject({ output: 'v' })
    await expect(store.get({ big: 2n, date: new Date(1) })).resolves.toBeUndefined()

    await store.set({ file: new Blob(['a']), id: 1 }, 'blobbed')
    await expect(store.get({ file: new Blob(['b']), id: 1 })).resolves.toMatchObject({ output: 'blobbed' })
  })

  it('supports a custom key serializer', async () => {
    const serializer = new RPCJsonSerializer()
    const serializeSpy = vi.spyOn(serializer, 'serialize')
    const store = new MemoryCacheStore({ serializer })

    await store.set({ id: 1 }, 'v')

    await expect(store.get({ id: 1 })).resolves.toMatchObject({ output: 'v' })
    expect(serializeSpy).toHaveBeenCalled()
  })

  it('returns fresh entries with a future expiresAt, then evicts at ttl without swr', async () => {
    const store = new MemoryCacheStore()

    await store.set('k', 'v', { ttl: 1 })
    await expect(store.get('k')).resolves.toEqual({ output: 'v', tags: undefined, expiresAt: 1 })

    vi.setSystemTime(999)
    await expect(store.get('k')).resolves.toBeDefined()

    vi.setSystemTime(1000)
    await expect(store.get('k')).resolves.toBeUndefined()
  })

  it('returns stale entries within the swr window, then evicts', async () => {
    const store = new MemoryCacheStore()

    await store.set('k', 'v', { ttl: 1, swr: 1 })

    vi.setSystemTime(1200) // past ttl, within swr
    await expect(store.get('k')).resolves.toEqual({ output: 'v', tags: undefined, expiresAt: 1 })

    vi.setSystemTime(2000) // past ttl + swr
    await expect(store.get('k')).resolves.toBeUndefined()
  })

  it('invalidates stale entries too, and overwrites replace tags and expiry', async () => {
    const store = new MemoryCacheStore()

    await store.set('stale', 'v', { tags: ['a'], ttl: 1, swr: 1 })
    await store.set('k', 'old', { tags: ['old'], ttl: 1 })
    await store.set('k', 'new', { tags: ['new'] })

    vi.setSystemTime(1200) // 'stale' is now stale
    await store.revalidate({ tags: ['a', 'old'] })

    await expect(store.get('stale')).resolves.toBeUndefined()
    await expect(store.get('k')).resolves.toEqual({ output: 'new', tags: ['new'], expiresAt: undefined })
  })
})
