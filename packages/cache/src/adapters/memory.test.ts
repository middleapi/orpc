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
