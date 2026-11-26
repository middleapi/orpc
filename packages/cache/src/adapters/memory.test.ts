import { RPCJsonSerializer } from '@orpc/client'
import { MemoryLocker } from '@orpc/experimental-lock/memory'

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

    await expect(
      store.getOrSet([['planet', 'find'], { a: 1, b: 2 }], async () => 'other'),
    ).resolves.toMatchObject({ output: 'v' })
    await expect(
      store.getOrSet([['planet', 'find'], { a: 1, b: 3 }], async () => 'other'),
    ).resolves.toMatchObject({ output: 'other' })
    await expect(
      store.getOrSet([['planet', 'list'], { a: 1, b: 2 }], async () => 'other'),
    ).resolves.toMatchObject({ output: 'other' })
  })

  it('encodes complex key values', async () => {
    const store = new MemoryCacheStore()

    await store.getOrSet({ date: new Date(1), big: 1n }, async () => 'v')
    await expect(
      store.getOrSet({ big: 1n, date: new Date(1) }, async () => 'other'),
    ).resolves.toMatchObject({ output: 'v' })
    await expect(
      store.getOrSet({ big: 2n, date: new Date(1) }, async () => 'other'),
    ).resolves.toMatchObject({ output: 'other' })
  })

  it('hands every hit its own copy of the output', async () => {
    const store = new MemoryCacheStore()

    await store.getOrSet('k', async () => ({ planets: ['Earth'] }))

    const hit = await store.getOrSet('k', async () => 'other')
    ;(hit.output as { planets: string[] }).planets.push('Mars')

    await expect(store.getOrSet('k', async () => 'other')).resolves.toMatchObject({
      output: { planets: ['Earth'] },
    })
  })

  it('supports a custom key serializer', async () => {
    const serializer = new RPCJsonSerializer()
    const serializeSpy = vi.spyOn(serializer, 'serializeJson')
    const store = new MemoryCacheStore({ serializer })

    await store.getOrSet({ id: 1 }, async () => 'v')

    await expect(store.getOrSet({ id: 1 }, async () => 'other')).resolves.toMatchObject({
      output: 'v',
    })
    expect(serializeSpy).toHaveBeenCalled()
  })

  it('returns fresh entries with a future expiresAt, then fills again at ttl without swr', async () => {
    const store = new MemoryCacheStore()

    await expect(store.getOrSet('k', async () => 'v', { ttl: 1000 })).resolves.toEqual({
      output: 'v',
      tags: undefined,
      expiresAt: 1000,
      evictAt: 1000,
    })

    vi.setSystemTime(999)
    await expect(store.getOrSet('k', async () => 'other', { ttl: 1000 })).resolves.toMatchObject({
      output: 'v',
    })

    vi.setSystemTime(1000)
    await expect(store.getOrSet('k', async () => 'other', { ttl: 1000 })).resolves.toEqual({
      output: 'other',
      tags: undefined,
      expiresAt: 2000,
      evictAt: 2000,
    })
  })

  it('serves stale entries within swr while one caller refreshes them in the background', async () => {
    const store = new MemoryCacheStore()
    await store.getOrSet('k', async () => 'v', { ttl: 1000, swr: 1000 })

    vi.setSystemTime(1200) // past ttl, within swr
    let finish!: (output: string) => void
    const fill = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve
        }),
    )
    const waitUntil = vi.fn()

    await expect(store.getOrSet('k', fill, { ttl: 1000, swr: 1000, waitUntil })).resolves.toEqual({
      output: 'v',
      tags: undefined,
      expiresAt: 1000,
      evictAt: 2000,
    })
    await expect(store.getOrSet('k', fill, { ttl: 1000, swr: 1000, waitUntil })).resolves.toEqual({
      output: 'v',
      tags: undefined,
      expiresAt: 1000,
      evictAt: 2000,
    })
    expect(waitUntil).toHaveBeenCalledTimes(2)

    // the second stale hit leaves the refresh to the first instead of waiting for it
    await expect(waitUntil.mock.calls[1]![0]).resolves.toBeUndefined()

    finish('fresh')
    await waitUntil.mock.calls[0]![0]
    expect(fill).toHaveBeenCalledTimes(1)

    await expect(store.getOrSet('k', fill, { ttl: 1000, swr: 1000 })).resolves.toEqual({
      output: 'fresh',
      tags: undefined,
      expiresAt: 2200,
      evictAt: 3200,
    })
  })

  it('leaves a failed refresh to waitUntil and keeps serving the stale entry', async () => {
    const store = new MemoryCacheStore()
    await store.getOrSet('k', async () => 'v', { ttl: 1000, swr: 1000 })

    vi.setSystemTime(1200)
    const waitUntil = vi.fn()
    const fill = vi.fn(async () => {
      throw new Error('handler down')
    })

    await expect(
      store.getOrSet('k', fill, { ttl: 1000, swr: 1000, waitUntil }),
    ).resolves.toMatchObject({ output: 'v' })
    await expect(waitUntil.mock.calls[0]![0]).rejects.toThrow('handler down')

    await expect(
      store.getOrSet('k', fill, { ttl: 1000, swr: 1000, waitUntil }),
    ).resolves.toMatchObject({ output: 'v' })
    await expect(waitUntil.mock.calls[1]![0]).rejects.toThrow('handler down')
    expect(fill).toHaveBeenCalledTimes(2)
  })

  it('runs the fill without storing when the lifetime leaves nothing to keep', async () => {
    const locker = new MemoryLocker({ ttl: 10_000 })
    const lock = vi.spyOn(locker, 'lock')
    const store = new MemoryCacheStore({ locker })
    const fill = vi.fn(async () => 'v')

    await expect(store.getOrSet('k', fill, { tags: ['t'], ttl: 0 })).resolves.toEqual({
      output: 'v',
      tags: ['t'],
      expiresAt: 0,
      evictAt: 0,
    })
    await expect(store.getOrSet('k', fill, { ttl: 0, swr: 0 })).resolves.toEqual({
      output: 'v',
      tags: undefined,
      expiresAt: 0,
      evictAt: 0,
    })
    expect(fill).toHaveBeenCalledTimes(2)
    expect((store as any).entries.size).toBe(0)
    expect(lock).not.toHaveBeenCalled()

    // and never refreshes a stale entry stored with a longer lifetime
    await store.getOrSet('stale', async () => 'v', { ttl: 1000, swr: 1000 })
    vi.setSystemTime(1200)
    lock.mockClear()
    const waitUntil = vi.fn()

    await expect(store.getOrSet('stale', fill, { ttl: 0, waitUntil })).resolves.toMatchObject({
      output: 'v',
    })
    expect(waitUntil).not.toHaveBeenCalled()
    expect(lock).not.toHaveBeenCalled()
  })

  it('refreshes without waiting for the lock', async () => {
    const locker = new MemoryLocker({ ttl: 10_000 })
    const lock = vi.spyOn(locker, 'lock')
    const store = new MemoryCacheStore({ locker })
    await store.getOrSet('k', async () => 'v', { ttl: 1000, swr: 1000 })

    vi.setSystemTime(1200)
    lock.mockClear()
    const waitUntil = vi.fn()
    await store.getOrSet('k', async () => 'fresh', { ttl: 1000, swr: 1000, waitUntil })
    await waitUntil.mock.calls[0]![0]

    expect(lock).toHaveBeenCalledTimes(1)
    expect(lock).toHaveBeenCalledWith('k', expect.any(Function), { timeout: 0 })
  })

  it('drops output computed before a revalidation that landed during its fill', async () => {
    const store = new MemoryCacheStore()
    let finish!: (output: string) => void
    let started!: () => void
    const filling = new Promise<void>((resolve) => {
      started = resolve
    })

    const first = store.getOrSet(
      'k',
      () => {
        started()
        return new Promise<string>((resolve) => {
          finish = resolve
        })
      },
      { tags: ['t'] },
    )
    await filling
    await store.revalidate({ tags: ['t'] })
    finish('outdated')

    await expect(first).resolves.toMatchObject({ output: 'outdated' })
    await expect(store.getOrSet('k', async () => 'fresh', { tags: ['t'] })).resolves.toMatchObject({
      output: 'fresh',
    })
  })

  it('drops a refresh computed before a revalidation that landed during it', async () => {
    const store = new MemoryCacheStore()
    await store.getOrSet('k', async () => 'v', { tags: ['t'], ttl: 1000, swr: 10_000 })

    vi.setSystemTime(1500)
    let finish!: (output: string) => void
    const waitUntil = vi.fn()

    await store.getOrSet(
      'k',
      () =>
        new Promise<string>((resolve) => {
          finish = resolve
        }),
      { tags: ['t'], ttl: 1000, swr: 10_000, waitUntil },
    )
    await store.revalidate({ tags: ['t'] })
    finish('outdated')
    await waitUntil.mock.calls[0]![0]

    await expect(store.getOrSet('k', async () => 'fresh', { tags: ['t'] })).resolves.toMatchObject({
      output: 'fresh',
    })
  })

  it('lets a waiter fill on its own once waiting for the lock times out', async () => {
    const store = new MemoryCacheStore({ locker: new MemoryLocker({ ttl: 10_000, timeout: 50 }) })
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const fill = vi.fn(async () => {
      await held
      return 'held'
    })

    const holder = store.getOrSet('k', fill)
    await expect(store.getOrSet('k', async () => 'waiter')).resolves.toMatchObject({
      output: 'waiter',
    })
    release()
    await expect(holder).resolves.toMatchObject({ output: 'held' })
  })

  it('rethrows other lock errors', async () => {
    const locker = {
      lock: vi.fn(async () => {
        throw new Error('locker down')
      }),
    }
    const store = new MemoryCacheStore({ locker })

    await expect(store.getOrSet('k', async () => 'v')).rejects.toThrow('locker down')
  })

  it('sweeps expired and revalidated entries on a later write, without reading them', async () => {
    const store = new MemoryCacheStore()
    const entries = Reflect.get(store, 'entries') as Map<string, unknown>

    await store.getOrSet('expiring', async () => 'v', { ttl: 10_000 })
    await store.getOrSet('tagged', async () => 'v', { tags: ['t'] })
    await store.getOrSet('kept', async () => 'v', { ttl: 100_000 })

    vi.setSystemTime(5000)
    await store.getOrSet('before', async () => 'v')
    expect([...entries.keys()]).toEqual(['expiring', 'tagged', 'kept', 'before'])

    vi.setSystemTime(10_000)
    await store.getOrSet('at', async () => 'v')
    expect([...entries.keys()]).toEqual(['tagged', 'kept', 'before', 'at'])

    await store.revalidate({ tags: ['t'] })
    vi.setSystemTime(11_000)
    await store.getOrSet('after', async () => 'v')
    expect([...entries.keys()]).toEqual(['kept', 'before', 'at', 'after'])
  })

  it('sweeps at most once a second', async () => {
    const store = new MemoryCacheStore()
    const entries = Reflect.get(store, 'entries') as Map<string, unknown>

    await store.getOrSet('first', async () => 'v', { ttl: 1000 })
    await store.getOrSet('second', async () => 'v', { ttl: 1500 })

    vi.setSystemTime(1000)
    await store.getOrSet('a', async () => 'v')
    expect([...entries.keys()]).toEqual(['second', 'a'])

    vi.setSystemTime(1600)
    await store.getOrSet('b', async () => 'v')
    expect([...entries.keys()]).toEqual(['second', 'a', 'b'])

    vi.setSystemTime(2000)
    await store.getOrSet('c', async () => 'v')
    expect([...entries.keys()]).toEqual(['a', 'b', 'c'])
  })

  it('evicts past ttl + swr, and revalidation drops stale entries too', async () => {
    const store = new MemoryCacheStore()

    await store.getOrSet('evicted', async () => 'v', { ttl: 1000, swr: 1000 })
    await store.getOrSet('stale', async () => 'v', { tags: ['a'], ttl: 1000, swr: 1000 })
    await store.getOrSet('k', async () => 'old', { tags: ['old'], ttl: 1000 })

    vi.setSystemTime(1000) // 'k' expired without swr, so it is filled again with new tags
    await expect(store.getOrSet('k', async () => 'new', { tags: ['new'] })).resolves.toEqual({
      output: 'new',
      tags: ['new'],
      expiresAt: undefined,
    })

    vi.setSystemTime(1200) // 'stale' and 'evicted' are stale
    await store.revalidate({ tags: ['a', 'old'] })
    await expect(
      store.getOrSet('stale', async () => 'refilled', { tags: ['a'] }),
    ).resolves.toMatchObject({ output: 'refilled' })
    await expect(
      store.getOrSet('k', async () => 'refilled', { tags: ['new'] }),
    ).resolves.toMatchObject({ output: 'new' })

    vi.setSystemTime(2000) // past ttl + swr
    await expect(store.getOrSet('evicted', async () => 'refilled')).resolves.toMatchObject({
      output: 'refilled',
    })
  })
})
