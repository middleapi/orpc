import { MemoryCacheStore } from './memory'

describe('memoryCacheStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('round-trips outputs, including undefined', async () => {
    const store = new MemoryCacheStore()

    await store.set('k', { nested: [1, 2] }, { tags: ['t'] })
    await expect(store.get('k')).resolves.toEqual({ output: { nested: [1, 2] }, tags: ['t'], expiresAt: undefined })

    await store.set('u', undefined)
    await expect(store.get('u')).resolves.toEqual({ output: undefined, tags: [], expiresAt: undefined })
  })

  it('misses on unknown keys', async () => {
    const store = new MemoryCacheStore()

    await expect(store.get('unknown')).resolves.toBeUndefined()
  })

  it('returns fresh entries with a future expiresAt, then evicts at ttl without swr', async () => {
    const store = new MemoryCacheStore()

    await store.set('k', 'v', { ttl: 1000 })
    await expect(store.get('k')).resolves.toEqual({ output: 'v', tags: [], expiresAt: 1000 })

    vi.setSystemTime(999)
    await expect(store.get('k')).resolves.toBeDefined()

    vi.setSystemTime(1000)
    await expect(store.get('k')).resolves.toBeUndefined()
  })

  it('returns stale entries within the swr window, then evicts', async () => {
    const store = new MemoryCacheStore()

    await store.set('k', 'v', { ttl: 1000, swr: 500 })

    vi.setSystemTime(1200) // past ttl, within swr
    await expect(store.get('k')).resolves.toEqual({ output: 'v', tags: [], expiresAt: 1000 })

    vi.setSystemTime(1500) // past ttl + swr
    await expect(store.get('k')).resolves.toBeUndefined()
  })

  it('invalidates fresh and stale entries by any of their tags', async () => {
    const store = new MemoryCacheStore()

    await store.set('multi', 'v', { tags: ['a', 'b'] })
    await store.set('stale', 'v', { tags: ['a'], ttl: 1000, swr: 500 })
    await store.set('other', 'v', { tags: ['c'] })

    vi.setSystemTime(1200) // 'stale' is now stale
    await store.revalidateTag('a')

    await expect(store.get('multi')).resolves.toBeUndefined()
    await expect(store.get('stale')).resolves.toBeUndefined()
    await expect(store.get('other')).resolves.toBeDefined()
  })

  it('revalidates many tags at once', async () => {
    const store = new MemoryCacheStore()

    await store.set('a', 'v', { tags: ['a'] })
    await store.set('b', 'v', { tags: ['b'] })

    await store.revalidateTag(['a', 'b'])

    await expect(store.get('a')).resolves.toBeUndefined()
    await expect(store.get('b')).resolves.toBeUndefined()
  })

  it('entries set after a revalidation remain valid', async () => {
    const store = new MemoryCacheStore()

    await store.set('k', 'old', { tags: ['t'] })
    await store.revalidateTag('t')
    await store.set('k', 'new', { tags: ['t'] })

    await expect(store.get('k')).resolves.toEqual({ output: 'new', tags: ['t'], expiresAt: undefined })
  })

  it('overwrites replace tags and expiry', async () => {
    const store = new MemoryCacheStore()

    await store.set('k', 'old', { tags: ['old'], ttl: 1000 })
    await store.set('k', 'new', { tags: ['new'] })

    await store.revalidateTag('old')
    vi.setSystemTime(2000)

    await expect(store.get('k')).resolves.toEqual({ output: 'new', tags: ['new'], expiresAt: undefined })
  })
})
