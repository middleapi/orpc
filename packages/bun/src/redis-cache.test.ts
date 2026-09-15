import { RPCJsonSerializer } from '@orpc/client'
import { nowInSeconds, sleep, stringifyJSON } from '@orpc/shared'
import { RedisClient } from 'bun'
import { beforeAll, describe, expect, it, mock, spyOn } from 'bun:test'
import { waitFor } from '../tests/__shared__/utils'
import { experimental_BunRedisCacheStore } from './redis-cache'
import { experimental_BunRedisLocker } from './redis-lock'

const REDIS_URL = Bun.env.REDIS_URL

describe.skipIf(!REDIS_URL)('bun redis cache store integration', () => {
  const redis = new RedisClient(REDIS_URL)

  // Closing the client here breaks the next file's client on Bun 1.4; the process exit closes it.
  beforeAll(async () => {
    await redis.connect()
  })

  function createTestingStore(options: ConstructorParameters<typeof experimental_BunRedisCacheStore>[1] = {}) {
    const prefix = options.prefix ?? `orpc-bun-redis-cache-store-${crypto.randomUUID()}:`
    return { store: new experimental_BunRedisCacheStore(redis, { ...options, prefix }), prefix }
  }

  function createLocker(options: { prefix: string, ttl: number, timeout: number }) {
    return new experimental_BunRedisLocker(redis, options)
  }

  it('fills a miss once, then serves the entry with its tags and expiresAt', async () => {
    const { store } = createTestingStore()
    const fill = mock(async () => ({ nested: [1, 2] }))

    const first = await store.getOrSet('k', fill, { tags: ['t'], ttl: 120 })
    expect(first.output).toEqual({ nested: [1, 2] })
    expect(first.tags).toEqual(['t'])
    expect(first.expiresAt).toBeGreaterThan(nowInSeconds())

    await expect(store.getOrSet('k', fill, { tags: ['t'], ttl: 120 })).resolves.toEqual(first)
    expect(fill).toHaveBeenCalledTimes(1)

    await store.getOrSet('u', async () => undefined)
    await expect(store.getOrSet('u', async () => 'refilled')).resolves.toEqual({ output: undefined, tags: undefined, expiresAt: undefined, evictAt: undefined })
  }, { timeout: 20_000 })

  it('preserves Date, Map, Set, and BigInt outputs', async () => {
    const { store } = createTestingStore()
    const output = {
      date: new Date('2026-01-02T03:04:05.678Z'),
      map: new Map([['a', 1]]),
      set: new Set([1, 2]),
      big: 123n,
    }

    await store.getOrSet('k', async () => output)
    await expect(store.getOrSet('k', async () => 'refilled')).resolves.toMatchObject({ output })
  }, { timeout: 20_000 })

  it('invalidates entries by any of their tags, and keeps ones filled afterwards', async () => {
    const { store } = createTestingStore()

    await store.getOrSet('multi', async () => 'v', { tags: ['a', 'b'] })
    await store.getOrSet('other', async () => 'v', { tags: ['c'] })

    await store.revalidate({ tags: ['a', 'b'] })

    await expect(store.getOrSet('multi', async () => 'new', { tags: ['a'] })).resolves.toMatchObject({ output: 'new' })
    await expect(store.getOrSet('other', async () => 'refilled', { tags: ['c'] })).resolves.toMatchObject({ output: 'v' })
    await expect(store.getOrSet('multi', async () => 'newer', { tags: ['a'] })).resolves.toMatchObject({ output: 'new' })
  }, { timeout: 20_000 })

  it('supports a custom serializer', async () => {
    const serializer = new RPCJsonSerializer()
    const serializeSpy = spyOn(serializer, 'serialize')
    const deserializeSpy = spyOn(serializer, 'deserialize')
    const { store } = createTestingStore({ serializer })

    await store.getOrSet('k', async () => ({ a: 1 }))

    await expect(store.getOrSet('k', async () => 'other')).resolves.toMatchObject({ output: { a: 1 } })
    expect(serializeSpy).toHaveBeenCalled()
    expect(deserializeSpy).toHaveBeenCalled()
  }, { timeout: 20_000 })

  it('fills again at ttl without swr, and serves stale within the swr window while refreshing', async () => {
    const { store } = createTestingStore()

    await store.getOrSet('no-swr', async () => 'v', { ttl: 1 })
    await store.getOrSet('swr', async () => 'v', { ttl: 1, swr: 10 })

    await sleep(1500)

    await expect(store.getOrSet('no-swr', async () => 'refilled', { ttl: 1 })).resolves.toMatchObject({ output: 'refilled' })

    const waitUntil = mock((_promise: Promise<unknown>) => {})
    const stale = await store.getOrSet('swr', async () => 'fresh', { ttl: 1, swr: 10, waitUntil })
    expect(stale.output).toBe('v')
    expect(stale.expiresAt).toBeLessThanOrEqual(nowInSeconds())

    expect(waitUntil).toHaveBeenCalledTimes(1)
    await waitUntil.mock.calls[0]![0]

    const fresh = await store.getOrSet('swr', async () => 'other', { ttl: 1, swr: 10 })
    expect(fresh.output).toBe('fresh')
    expect(fresh.expiresAt).toBeGreaterThan(stale.expiresAt!)
  }, { timeout: 20_000 })

  it('stores entries as strings and tag counters under the prefixed key families', async () => {
    const { store, prefix } = createTestingStore()

    await store.getOrSet('k', async () => 'v', { tags: ['t'] })
    await expect(redis.send('TYPE', [`${prefix}e:k`])).resolves.toBe('string')
    await expect(redis.exists(`${prefix}t:t`)).resolves.toBe(false)

    await store.revalidate({ tags: ['t'] })
    await expect(redis.send('TYPE', [`${prefix}t:t`])).resolves.toBe('string')

    const unprefixed = new experimental_BunRedisCacheStore(redis)
    const key = crypto.randomUUID()
    await unprefixed.getOrSet(key, async () => 'v')
    await expect(redis.exists(`e:${key}`)).resolves.toBe(true)
  }, { timeout: 20_000 })

  it('validates against the tags stored with the entry, treating tags missing from the snapshot as version zero', async () => {
    const { store, prefix } = createTestingStore()

    await redis.set(`${prefix}e:k`, stringifyJSON({ output: { json: 'v' }, tags: ['stored'] })!)

    await expect(store.getOrSet('k', async () => 'other', { tags: ['other'] })).resolves.toMatchObject({ output: 'v', tags: ['stored'] })

    await store.revalidate({ tags: ['stored'] })
    await expect(store.getOrSet('k', async () => 'refilled', { tags: ['other'] })).resolves.toMatchObject({ output: 'refilled', tags: ['other'] })
  }, { timeout: 20_000 })

  it('evicts entries past evictAt that the server still holds', async () => {
    const { store, prefix } = createTestingStore()

    await redis.set(`${prefix}e:k`, stringifyJSON({ output: { json: 'v' }, expiresAt: 1, evictAt: 1 })!)

    await expect(store.getOrSet('k', async () => 'refilled')).resolves.toMatchObject({ output: 'refilled', expiresAt: undefined })
  }, { timeout: 20_000 })

  it('rejects entries it cannot parse', async () => {
    const { store, prefix } = createTestingStore()

    await redis.set(`${prefix}e:broken`, 'not json')

    await expect(store.getOrSet('broken', async () => 'v')).rejects.toThrow()
  }, { timeout: 20_000 })

  it('encodes non-string keys stably', async () => {
    const { store } = createTestingStore()

    await store.getOrSet([['planet', 'find'], { b: 2, a: 1 }], async () => 'v')

    await expect(store.getOrSet([['planet', 'find'], { a: 1, b: 2 }], async () => 'other')).resolves.toMatchObject({ output: 'v' })
    await expect(store.getOrSet([['planet', 'find'], { a: 1, b: 3 }], async () => 'other')).resolves.toMatchObject({ output: 'other' })
  }, { timeout: 20_000 })

  it('fills once for concurrent callers of one key, and lets a waiter fill when the holder failed', async () => {
    const { store } = createTestingStore()
    let finish!: (output: string) => void
    const fill = mock(() => new Promise<string>((resolve) => {
      finish = resolve
    }))

    const pending = Promise.all([store.getOrSet('k', fill), store.getOrSet('k', fill), store.getOrSet('k', fill)])
    await waitFor(() => expect(fill).toHaveBeenCalledTimes(1), { timeout: 5000 })
    finish('v')

    const entries = await pending
    expect(entries.map(entry => entry.output)).toEqual(['v', 'v', 'v'])
    expect(fill).toHaveBeenCalledTimes(1)

    let fail!: (error: Error) => void
    let started!: () => void
    const holding = new Promise<void>((resolve) => {
      started = resolve
    })
    const first = store.getOrSet('failing', () => {
      started()
      return new Promise<never>((_, reject) => {
        fail = reject
      })
    })
    await holding
    const second = store.getOrSet('failing', async () => 'fresh')
    fail(new Error('handler down'))

    await expect(first).rejects.toThrow('handler down')
    await expect(second).resolves.toMatchObject({ output: 'fresh' })
  }, { timeout: 20_000 })

  it('drops output computed before a revalidation that landed during its fill', async () => {
    const { store } = createTestingStore()
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
  }, { timeout: 20_000 })

  it('coalesces fills across stores sharing a locker, and lets a waiter fill once its wait times out', async () => {
    const lockPrefix = `${crypto.randomUUID()}:`
    const { store: first, prefix } = createTestingStore({ locker: createLocker({ prefix: lockPrefix, ttl: 5000, timeout: 5000 }) })
    const { store: second } = createTestingStore({ prefix, locker: createLocker({ prefix: lockPrefix, ttl: 5000, timeout: 300 }) })
    const { store: third } = createTestingStore({ prefix, locker: createLocker({ prefix: lockPrefix, ttl: 5000, timeout: 5000 }) })
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const fill = mock(async () => {
      await held
      return 'held'
    })

    const holder = first.getOrSet('k', fill)
    await waitFor(() => expect(fill).toHaveBeenCalledTimes(1), { timeout: 5000 })

    let settled = false
    const timedOut = second.getOrSet('k', async () => 'waiter').then((entry) => {
      settled = true
      return entry
    })
    const waiterFill = mock(async () => 'third')
    const waiter = third.getOrSet('k', waiterFill)
    await sleep(100)
    expect(settled).toBe(false)
    await expect(timedOut).resolves.toMatchObject({ output: 'waiter' })

    release()
    await expect(holder).resolves.toMatchObject({ output: 'held' })
    await expect(waiter).resolves.toMatchObject({ output: 'held' })
    expect(waiterFill).not.toHaveBeenCalled()
  }, { timeout: 20_000 })
})
