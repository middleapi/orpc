import type { CacheStore } from '../../src'
import type { BaseRedisCacheStoreOptions } from '../../src/adapters/base-redis'
import { RPCJsonSerializer } from '@orpc/client'
import { nowInSeconds, sleep, stringifyJSON } from '@orpc/shared'
import { expect, it, vi } from 'vitest'

export interface RedisCacheStoreContractClient {
  exists: (key: string) => Promise<number>
  type: (key: string) => Promise<string>
  hset: (key: string, fields: Record<string, string>) => Promise<unknown>
  scriptFlush: () => Promise<unknown>
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

    await store.getOrSet('no-swr', async () => 'v', { ttl: 1 })
    await store.getOrSet('swr', async () => 'v', { ttl: 1, swr: 10 })

    await sleep(1500)

    await expect(store.getOrSet('no-swr', async () => 'refilled', { ttl: 1 })).resolves.toMatchObject({ output: 'refilled' })

    const waitUntil = vi.fn()
    const stale = await store.getOrSet('swr', async () => 'fresh', { ttl: 1, swr: 10, waitUntil })
    expect(stale.output).toBe('v')
    expect(stale.expiresAt).toBeLessThanOrEqual(nowInSeconds())

    expect(waitUntil).toHaveBeenCalledTimes(1)
    await waitUntil.mock.calls[0]![0]

    const fresh = await store.getOrSet('swr', async () => 'other', { ttl: 1, swr: 10 })
    expect(fresh.output).toBe('fresh')
    expect(fresh.expiresAt).toBeGreaterThan(stale.expiresAt!)
  })

  it('stores entries as hashes and tag counters under the prefixed key families, locking while filling', async () => {
    const { store, prefix } = createStore()

    await store.getOrSet('k', async () => {
      await expect(redis.exists(`${prefix}l:k`)).resolves.toBe(1)
      return 'v'
    }, { tags: ['t'] })
    await store.revalidate({ tags: ['t'] })

    await expect(redis.type(`${prefix}e:k`)).resolves.toBe('hash')
    await expect(redis.exists(`${prefix}t:t`)).resolves.toBe(1)
    await expect(redis.exists(`${prefix}l:k`)).resolves.toBe(0)
  })

  it('defaults to no prefix', async () => {
    const { store } = createStore({ prefix: '' })
    const key = crypto.randomUUID()

    await store.getOrSet(key, async () => 'v')

    await expect(redis.exists(`e:${key}`)).resolves.toBe(1)
    await expect(store.getOrSet(key, async () => 'other')).resolves.toMatchObject({ output: 'v' })
  })

  it('treats tags missing from the snapshot as version zero', async () => {
    const { store, prefix } = createStore()

    await redis.hset(`${prefix}e:k`, { output: stringifyJSON({ json: 'v' }), tags: '["t"]', tagVersions: '{}' })

    await expect(store.getOrSet('k', async () => 'other')).resolves.toMatchObject({ output: 'v' })
  })

  it('reloads scripts the server dropped, and rethrows other script errors', async () => {
    const { store, prefix } = createStore()

    await store.getOrSet('k', async () => 'v')
    await redis.scriptFlush()
    await expect(store.getOrSet('k', async () => 'other')).resolves.toMatchObject({ output: 'v' })

    await redis.hset(`${prefix}e:broken`, { output: '{}', tags: 'not json', tagVersions: '{}' })
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

  it('frees waiters after lockTtl and leaves a lock taken over that way alone', async () => {
    const { store: holderStore, prefix } = createStore({ lockTtl: 1 })
    const { store: waiterStore } = createStore({ prefix })
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let takenOver!: () => void
    const takeover = new Promise<void>((resolve) => {
      takenOver = resolve
    })

    const holder = holderStore.getOrSet('k', async () => {
      await takeover
      return 'holder'
    })
    await vi.waitFor(() => expect(redis.exists(`${prefix}l:k`)).resolves.toBe(1), { timeout: 5000 })

    const waiter = waiterStore.getOrSet('k', async () => {
      takenOver()
      await held
      return 'waiter'
    })

    await expect(holder).resolves.toMatchObject({ output: 'holder' })
    await expect(redis.exists(`${prefix}l:k`)).resolves.toBe(1)

    release()
    await expect(waiter).resolves.toMatchObject({ output: 'waiter' })
    await expect(redis.exists(`${prefix}l:k`)).resolves.toBe(0)
    await expect(holderStore.getOrSet('k', async () => 'other')).resolves.toMatchObject({ output: 'waiter' })
  })

  it('keeps the entry of the fill that took over when the original holder finishes later', async () => {
    const { store: holderStore, prefix } = createStore({ lockTtl: 1 })
    const { store: waiterStore } = createStore({ prefix })
    let takenOver!: () => void
    const takeover = new Promise<void>((resolve) => {
      takenOver = resolve
    })

    const holder = holderStore.getOrSet('k', async () => {
      await takeover
      return 'holder'
    })
    await vi.waitFor(() => expect(redis.exists(`${prefix}l:k`)).resolves.toBe(1), { timeout: 5000 })

    await expect(waiterStore.getOrSet('k', async () => 'waiter')).resolves.toMatchObject({ output: 'waiter' })
    takenOver()
    await expect(holder).resolves.toMatchObject({ output: 'holder' })

    await expect(waiterStore.getOrSet('k', async () => 'other')).resolves.toMatchObject({ output: 'waiter' })
    await expect(redis.exists(`${prefix}l:k`)).resolves.toBe(0)
  })
}
