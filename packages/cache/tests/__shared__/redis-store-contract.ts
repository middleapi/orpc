import type { Locker } from '@orpc/experimental-lock'
import type { CacheStore } from '../../src'
import type { BaseRedisCacheStoreOptions } from '../../src/adapters/base-redis'
import { RPCJsonSerializer } from '@orpc/client'
import { sleep, stringifyJSON } from '@orpc/shared'
import { expect, it, vi } from 'vitest'

export interface RedisCacheStoreContractClient {
  exists: (key: string) => Promise<number>
  type: (key: string) => Promise<string>
  set: (key: string, value: string) => Promise<unknown>
  /**
   * A locker sharing locks under `prefix` across stores, as `RedisLocker` does.
   */
  createLocker: (options: { prefix: string, ttl: number, timeout: number }) => Locker
}

/**
 * The behavior every Redis-backed store shares, run against one adapter and
 * a client that can inspect the keys it writes. `createStore` applies the
 * given options over a fresh prefix, or the given one.
 */
export function describeRedisCacheStoreContract(
  createStore: (options?: BaseRedisCacheStoreOptions) => { store: CacheStore, prefix: string },
  redis: RedisCacheStoreContractClient,
): void {
  it('supports a custom serializer', async () => {
    const serializer = new RPCJsonSerializer()
    const serializeSpy = vi.spyOn(serializer, 'serialize')
    const deserializeSpy = vi.spyOn(serializer, 'deserialize')
    const { store } = createStore({ serializer })

    await store.getOrSet('k', async () => ({ a: 1 }))

    await expect(store.getOrSet('k', async () => 'other')).resolves.toMatchObject({ output: { a: 1 } })
    expect(serializeSpy).toHaveBeenCalled()
    expect(deserializeSpy).toHaveBeenCalled()
  })

  it('fills again at ttl without swr, and serves stale within the swr window while refreshing', async () => {
    const { store } = createStore()

    await store.getOrSet('no-swr', async () => 'v', { ttl: 1000 })
    await store.getOrSet('swr', async () => 'v', { ttl: 1000, swr: 10_000 })

    await sleep(1500)

    await expect(store.getOrSet('no-swr', async () => 'refilled', { ttl: 1000 })).resolves.toMatchObject({ output: 'refilled' })

    const waitUntil = vi.fn()
    const stale = await store.getOrSet('swr', async () => 'fresh', { ttl: 1000, swr: 10_000, waitUntil })
    expect(stale.output).toBe('v')
    expect(stale.expiresAt).toBeLessThanOrEqual(Date.now())

    expect(waitUntil).toHaveBeenCalledTimes(1)
    await waitUntil.mock.calls[0]![0]

    const fresh = await store.getOrSet('swr', async () => 'other', { ttl: 1000, swr: 10_000 })
    expect(fresh.output).toBe('fresh')
    expect(fresh.expiresAt).toBeGreaterThan(stale.expiresAt!)
  })

  it('stores entries as strings and tag counters under the prefixed key families', async () => {
    const { store, prefix } = createStore()

    await store.getOrSet('k', async () => 'v', { tags: ['t'] })
    await expect(redis.type(`${prefix}e:k`)).resolves.toBe('string')
    await expect(redis.exists(`${prefix}t:t`)).resolves.toBe(0)

    await store.revalidate({ tags: ['t'] })
    await expect(redis.type(`${prefix}t:t`)).resolves.toBe('string')
  })

  it('defaults to no prefix', async () => {
    const { store } = createStore({ prefix: '' })
    const key = crypto.randomUUID()

    await store.getOrSet(key, async () => 'v')

    await expect(redis.exists(`e:${key}`)).resolves.toBe(1)
    await expect(store.getOrSet(key, async () => 'other')).resolves.toMatchObject({ output: 'v' })
  })

  it('validates against the tags stored with the entry, treating tags missing from the snapshot as version zero', async () => {
    const { store, prefix } = createStore()

    await redis.set(`${prefix}e:k`, stringifyJSON({ output: { json: 'v' }, tags: ['stored'] })!)

    await expect(store.getOrSet('k', async () => 'other')).resolves.toMatchObject({ output: 'v', tags: ['stored'] })
    await expect(store.getOrSet('k', async () => 'other', { tags: ['other'] })).resolves.toMatchObject({ output: 'v', tags: ['stored'] })

    await store.revalidate({ tags: ['stored'] })
    await expect(store.getOrSet('k', async () => 'refilled', { tags: ['other'] })).resolves.toMatchObject({ output: 'refilled', tags: ['other'] })
  })

  it('evicts entries past evictAt that the server still holds', async () => {
    const { store, prefix } = createStore()

    await redis.set(`${prefix}e:k`, stringifyJSON({ output: { json: 'v' }, expiresAt: 1, evictAt: 1 })!)

    await expect(store.getOrSet('k', async () => 'refilled')).resolves.toMatchObject({ output: 'refilled', expiresAt: undefined })
  })

  it('rejects entries it cannot parse', async () => {
    const { store, prefix } = createStore()

    await redis.set(`${prefix}e:broken`, 'not json')

    await expect(store.getOrSet('broken', async () => 'v')).rejects.toThrow()
  })

  it('drops output computed before a revalidation that landed during its fill', async () => {
    const { store } = createStore()
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

  it('stays consistent under concurrent pending and a revalidation on a shared tag', async () => {
    const { store } = createStore()
    const keys = Array.from({ length: 20 }, (_, index) => `k${index}`)

    await Promise.all([
      ...keys.map(key => store.getOrSet(key, async () => key, { tags: ['t'] })),
      store.revalidate({ tags: ['t'] }),
    ])

    const entries = await Promise.all(keys.map(key => store.getOrSet(key, async () => key, { tags: ['t'] })))
    expect(entries.map(entry => entry.output)).toEqual(keys)
  })

  it('coalesces fills across stores sharing a locker, and lets a waiter fill once its wait times out', async () => {
    const { store: holderStore, prefix } = createStore({ locker: redis.createLocker({ prefix: `${crypto.randomUUID()}:`, ttl: 5000, timeout: 5000 }) })
    const { store: waiterStore } = createStore({ prefix, locker: redis.createLocker({ prefix: `${crypto.randomUUID()}:`, ttl: 5000, timeout: 5000 }) })
    const lockPrefix = `${crypto.randomUUID()}:`
    const { store: first } = createStore({ prefix, locker: redis.createLocker({ prefix: lockPrefix, ttl: 5000, timeout: 5000 }) })
    const { store: second } = createStore({ prefix, locker: redis.createLocker({ prefix: lockPrefix, ttl: 5000, timeout: 300 }) })
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const fill = vi.fn(async () => {
      await held
      return 'held'
    })

    // Separate lockers never wait for each other.
    const unshared = holderStore.getOrSet('unshared', fill)
    await vi.waitFor(() => expect(fill).toHaveBeenCalledTimes(1))
    await expect(waiterStore.getOrSet('unshared', async () => 'waiter')).resolves.toMatchObject({ output: 'waiter' })

    // A shared locker makes the second store wait, then fill itself once its timeout passes.
    const holder = first.getOrSet('shared', fill)
    await vi.waitFor(() => expect(fill).toHaveBeenCalledTimes(2))
    let settled = false
    const waiter = second.getOrSet('shared', async () => 'waiter').then((entry) => {
      settled = true
      return entry
    })
    await sleep(100)
    expect(settled).toBe(false)
    await expect(waiter).resolves.toMatchObject({ output: 'waiter' })

    release()
    await expect(unshared).resolves.toMatchObject({ output: 'held' })
    await expect(holder).resolves.toMatchObject({ output: 'held' })
  })

  it('serves a shared-locker waiter the entry the holder stored', async () => {
    const lockPrefix = `${crypto.randomUUID()}:`
    const { store: first, prefix } = createStore({ locker: redis.createLocker({ prefix: lockPrefix, ttl: 5000, timeout: 5000 }) })
    const { store: second } = createStore({ prefix, locker: redis.createLocker({ prefix: lockPrefix, ttl: 5000, timeout: 5000 }) })
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const fill = vi.fn(async () => {
      await held
      return 'held'
    })

    const holder = first.getOrSet('k', fill)
    await vi.waitFor(() => expect(fill).toHaveBeenCalledTimes(1))
    const waiterFill = vi.fn(async () => 'waiter')
    const waiter = second.getOrSet('k', waiterFill)
    await sleep(100)

    release()
    await expect(holder).resolves.toMatchObject({ output: 'held' })
    await expect(waiter).resolves.toMatchObject({ output: 'held' })
    expect(waiterFill).not.toHaveBeenCalled()
  })
}
