import { RPCJsonSerializer } from '@orpc/client'
import { describeCacheStoreContract } from '../../tests/__shared__/store-contract'
import { MemoryCacheStore } from './memory'

describe('memoryCacheStore', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describeCacheStoreContract(() => new MemoryCacheStore())

  it('encodes structurally equal non-string keys to the same entry', async () => {
    const store = new MemoryCacheStore()

    await store.getOrSet([['planet', 'find'], { b: 2, a: 1 }], async () => 'v')

    await expect(store.getOrSet([['planet', 'find'], { a: 1, b: 2 }], async () => 'other')).resolves.toMatchObject({ output: 'v' })
    await expect(store.getOrSet([['planet', 'find'], { a: 1, b: 3 }], async () => 'other')).resolves.toMatchObject({ output: 'other' })
    await expect(store.getOrSet([['planet', 'list'], { a: 1, b: 2 }], async () => 'other')).resolves.toMatchObject({ output: 'other' })
  })

  it('encodes complex key values, ignoring unsupported ones like blobs', async () => {
    const store = new MemoryCacheStore()

    await store.getOrSet({ date: new Date(1), big: 1n }, async () => 'v')
    await expect(store.getOrSet({ big: 1n, date: new Date(1) }, async () => 'other')).resolves.toMatchObject({ output: 'v' })
    await expect(store.getOrSet({ big: 2n, date: new Date(1) }, async () => 'other')).resolves.toMatchObject({ output: 'other' })

    await store.getOrSet({ file: new Blob(['a']), id: 1 }, async () => 'blobbed')
    await expect(store.getOrSet({ file: new Blob(['b']), id: 1 }, async () => 'other')).resolves.toMatchObject({ output: 'blobbed' })
  })

  it('supports a custom key serializer', async () => {
    const serializer = new RPCJsonSerializer()
    const serializeSpy = vi.spyOn(serializer, 'serialize')
    const store = new MemoryCacheStore({ serializer })

    await store.getOrSet({ id: 1 }, async () => 'v')

    await expect(store.getOrSet({ id: 1 }, async () => 'other')).resolves.toMatchObject({ output: 'v' })
    expect(serializeSpy).toHaveBeenCalled()
  })

  it('returns fresh entries with a future expiresAt, then fills again at ttl without swr', async () => {
    const store = new MemoryCacheStore()

    await expect(store.getOrSet('k', async () => 'v', { ttl: 1 })).resolves.toEqual({ output: 'v', tags: undefined, expiresAt: 1, evictAt: 1 })

    vi.setSystemTime(999)
    await expect(store.getOrSet('k', async () => 'other', { ttl: 1 })).resolves.toMatchObject({ output: 'v' })

    vi.setSystemTime(1000)
    await expect(store.getOrSet('k', async () => 'other', { ttl: 1 })).resolves.toEqual({ output: 'other', tags: undefined, expiresAt: 2, evictAt: 2 })
  })

  it('serves stale entries within swr while one caller refreshes them in the background', async () => {
    const store = new MemoryCacheStore()
    await store.getOrSet('k', async () => 'v', { ttl: 1, swr: 1 })

    vi.setSystemTime(1200) // past ttl, within swr
    let finish!: (output: string) => void
    const fill = vi.fn(() => new Promise<string>((resolve) => {
      finish = resolve
    }))
    const waitUntil = vi.fn()

    await expect(store.getOrSet('k', fill, { ttl: 1, swr: 1, waitUntil })).resolves.toEqual({ output: 'v', tags: undefined, expiresAt: 1, evictAt: 2 })
    await expect(store.getOrSet('k', fill, { ttl: 1, swr: 1, waitUntil })).resolves.toEqual({ output: 'v', tags: undefined, expiresAt: 1, evictAt: 2 })
    expect(waitUntil).toHaveBeenCalledTimes(2)

    finish('fresh')
    await Promise.all(waitUntil.mock.calls.map(([refresh]) => refresh))
    expect(fill).toHaveBeenCalledTimes(1) // the second stale hit found the refreshed entry

    await expect(store.getOrSet('k', fill, { ttl: 1, swr: 1 })).resolves.toEqual({ output: 'fresh', tags: undefined, expiresAt: 2, evictAt: 3 })
  })

  it('leaves a failed refresh to waitUntil and keeps serving the stale entry', async () => {
    const store = new MemoryCacheStore()
    await store.getOrSet('k', async () => 'v', { ttl: 1, swr: 1 })

    vi.setSystemTime(1200)
    const waitUntil = vi.fn()
    const fill = vi.fn(async () => {
      throw new Error('handler down')
    })

    await expect(store.getOrSet('k', fill, { ttl: 1, swr: 1, waitUntil })).resolves.toMatchObject({ output: 'v' })
    await expect(waitUntil.mock.calls[0]![0]).rejects.toThrow('handler down')

    await expect(store.getOrSet('k', fill, { ttl: 1, swr: 1, waitUntil })).resolves.toMatchObject({ output: 'v' })
    await expect(waitUntil.mock.calls[1]![0]).rejects.toThrow('handler down')
    expect(fill).toHaveBeenCalledTimes(2)
  })

  it('lets a waiting refresh fill when the first one failed', async () => {
    const store = new MemoryCacheStore()
    await store.getOrSet('k', async () => 'v', { ttl: 1, swr: 1 })

    vi.setSystemTime(1200)
    let fail!: (error: Error) => void
    const fill = vi.fn()
      .mockImplementationOnce(() => new Promise<never>((_, reject) => {
        fail = reject
      }))
      .mockResolvedValue('fresh')
    const waitUntil = vi.fn()

    await store.getOrSet('k', fill, { ttl: 1, swr: 1, waitUntil })
    await store.getOrSet('k', fill, { ttl: 1, swr: 1, waitUntil })
    fail(new Error('handler down'))

    await expect(waitUntil.mock.calls[0]![0]).rejects.toThrow('handler down')
    await waitUntil.mock.calls[1]![0]
    expect(fill).toHaveBeenCalledTimes(2)

    await expect(store.getOrSet('k', fill, { ttl: 1, swr: 1 })).resolves.toMatchObject({ output: 'fresh' })
  })

  it('drops output computed before a revalidation that landed during its fill', async () => {
    const store = new MemoryCacheStore()
    let finish!: (output: string) => void
    let started!: () => void
    const filling = new Promise<void>((resolve) => {
      started = resolve
    })

    const first = store.getOrSet('k', () => {
      started()
      return new Promise<string>((resolve) => {
        finish = resolve
      })
    }, { tags: ['t'] })
    await filling
    await store.revalidate({ tags: ['t'] })
    finish('outdated')

    await expect(first).resolves.toMatchObject({ output: 'outdated' })
    await expect(store.getOrSet('k', async () => 'fresh', { tags: ['t'] })).resolves.toMatchObject({ output: 'fresh' })
  })

  it('drops a refresh computed before a revalidation that landed during it', async () => {
    const store = new MemoryCacheStore()
    await store.getOrSet('k', async () => 'v', { tags: ['t'], ttl: 1, swr: 10 })

    vi.setSystemTime(1500)
    let finish!: (output: string) => void
    const waitUntil = vi.fn()

    await store.getOrSet('k', () => new Promise<string>((resolve) => {
      finish = resolve
    }), { tags: ['t'], ttl: 1, swr: 10, waitUntil })
    await store.revalidate({ tags: ['t'] })
    finish('outdated')
    await waitUntil.mock.calls[0]![0]

    await expect(store.getOrSet('k', async () => 'fresh', { tags: ['t'] })).resolves.toMatchObject({ output: 'fresh' })
  })

  it('sweeps expired and revalidated entries on a later write, without reading them', async () => {
    const store = new MemoryCacheStore()
    const entries = Reflect.get(store, 'entries') as Map<string, unknown>

    await store.getOrSet('expiring', async () => 'v', { ttl: 10 })
    await store.getOrSet('tagged', async () => 'v', { tags: ['t'] })
    await store.getOrSet('kept', async () => 'v', { ttl: 100 })

    vi.setSystemTime(5000)
    await store.getOrSet('before', async () => 'v')
    expect([...entries.keys()]).toEqual(['expiring', 'tagged', 'kept', 'before'])

    vi.setSystemTime(10_000)
    await store.getOrSet('at', async () => 'v')
    expect([...entries.keys()]).toEqual(['tagged', 'kept', 'before', 'at'])

    await store.revalidate({ tags: ['t'] })
    await store.getOrSet('after', async () => 'v')
    expect([...entries.keys()]).toEqual(['kept', 'before', 'at', 'after'])
  })

  it('evicts past ttl + swr, and revalidation drops stale entries too', async () => {
    const store = new MemoryCacheStore()

    await store.getOrSet('evicted', async () => 'v', { ttl: 1, swr: 1 })
    await store.getOrSet('stale', async () => 'v', { tags: ['a'], ttl: 1, swr: 1 })
    await store.getOrSet('k', async () => 'old', { tags: ['old'], ttl: 1 })

    vi.setSystemTime(1000) // 'k' expired without swr, so it is filled again with new tags
    await expect(store.getOrSet('k', async () => 'new', { tags: ['new'] })).resolves.toEqual({ output: 'new', tags: ['new'], expiresAt: undefined })

    vi.setSystemTime(1200) // 'stale' and 'evicted' are stale
    await store.revalidate({ tags: ['a', 'old'] })
    await expect(store.getOrSet('stale', async () => 'refilled', { tags: ['a'] })).resolves.toMatchObject({ output: 'refilled' })
    await expect(store.getOrSet('k', async () => 'refilled', { tags: ['new'] })).resolves.toMatchObject({ output: 'new' })

    vi.setSystemTime(2000) // past ttl + swr
    await expect(store.getOrSet('evicted', async () => 'refilled')).resolves.toMatchObject({ output: 'refilled' })
  })
})
