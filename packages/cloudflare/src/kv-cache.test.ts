import type { experimental_KVCacheStoreOptions } from './kv-cache'
import { RPCSerializer } from '@orpc/client'
import { nowInSeconds } from '@orpc/shared'
import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { holdResult } from '../tests/__shared__/utils'
import { experimental_KVCacheStore } from './kv-cache'

describe('experimental_KVCacheStore', () => {
  function createTestingStore(options: Partial<experimental_KVCacheStoreOptions> = {}) {
    const prefix = `orpc-kv-cache-store-${crypto.randomUUID()}:`
    return { store: new experimental_KVCacheStore(env.CACHE_KV, { prefix, ...options }), prefix }
  }

  // The cross-package tsconfig rootDir keeps the shared store contract out of
  // reach here, so the shared behavior is asserted again against real KV.
  it('round-trips outputs with their tags and expiresAt, including undefined', async () => {
    const { store } = createTestingStore()

    await store.set('k', { nested: [1, 2] }, { tags: ['t'], ttl: 120 })

    const entry = await store.get('k')
    expect(entry!.output).toEqual({ nested: [1, 2] })
    expect(entry!.tags).toEqual(['t'])
    expect(entry!.expiresAt).toBeGreaterThan(nowInSeconds())

    await store.set('u', undefined)
    await expect(store.get('u')).resolves.toEqual({ output: undefined, tags: undefined, expiresAt: undefined })
    await expect(store.get('unknown')).resolves.toBeUndefined()
  })

  it('preserves Date, Map, Set, and BigInt outputs', async () => {
    const { store } = createTestingStore()
    const output = {
      date: new Date('2026-01-02T03:04:05.678Z'),
      map: new Map([['a', 1]]),
      set: new Set([1, 2]),
      big: 123n,
    }

    await store.set('k', output)
    await expect(store.get('k')).resolves.toMatchObject({ output })
  })

  it('invalidates entries by any of their tags, and keeps ones set afterwards', async () => {
    const { store } = createTestingStore()

    await store.set('multi', 'v', { tags: ['a', 'b'] })
    await store.set('other', 'v', { tags: ['c'] })

    await store.revalidate({ tags: ['a', 'b'] })

    await expect(store.get('multi')).resolves.toBeUndefined()
    await expect(store.get('other')).resolves.toBeDefined()

    await store.set('multi', 'new', { tags: ['a'] })
    await expect(store.get('multi')).resolves.toMatchObject({ output: 'new' })
  })

  it('supports a custom serializer', async () => {
    const serializer = new RPCSerializer()
    const serializeSpy = vi.spyOn(serializer, 'serialize')
    const deserializeSpy = vi.spyOn(serializer, 'deserialize')
    const { store } = createTestingStore({ serializer })

    await store.set('k', { a: 1 })

    await expect(store.get('k')).resolves.toMatchObject({ output: { a: 1 } })
    expect(serializeSpy).toHaveBeenCalled()
    expect(deserializeSpy).toHaveBeenCalled()
  })

  it('serves stale entries within the swr window, then evicts at the exact bound', async () => {
    const { store, prefix } = createTestingStore()

    // Craft envelopes directly so the test does not have to wait for real time to pass.
    const envelope = (expiresAt: number, evictAt: number) => JSON.stringify({
      output: { json: 'v' },
      tags: [],
      tagTokens: {},
      expiresAt,
      evictAt,
    })

    await env.CACHE_KV.put(`${prefix}e:stale`, envelope(nowInSeconds() - 1, nowInSeconds() + 60))
    await env.CACHE_KV.put(`${prefix}e:evicted`, envelope(nowInSeconds() - 2, nowInSeconds() - 1))

    const stale = await store.get('stale')
    expect(stale!.output).toBe('v')
    expect(stale!.expiresAt).toBeLessThanOrEqual(nowInSeconds())

    await expect(store.get('evicted')).resolves.toBeUndefined()
    await expect(env.CACHE_KV.get(`${prefix}e:evicted`)).resolves.toBeNull()
  })

  it('defaults to no prefix', async () => {
    const store = new experimental_KVCacheStore(env.CACHE_KV)
    const key = crypto.randomUUID()

    await store.set(key, 'v')

    await expect(env.CACHE_KV.get(`e:${key}`)).resolves.toBeTypeOf('string')
    await expect(store.get(key)).resolves.toMatchObject({ output: 'v' })
  })

  it('stores entries and tag tokens under the prefixed key families', async () => {
    const { store, prefix } = createTestingStore()

    await store.set('k', 'v', { tags: ['t'] })
    await store.revalidate({ tags: ['t'] })

    await expect(env.CACHE_KV.get(`${prefix}e:k`)).resolves.toBeTypeOf('string')
    await expect(env.CACHE_KV.get(`${prefix}t:t`)).resolves.toBeTypeOf('string')
  })

  it('drops an entry whose tag tokens were read before a racing revalidation', async () => {
    const { client: kv, release } = holdResult(env.CACHE_KV, 'get')
    const prefix = `orpc-kv-cache-store-${crypto.randomUUID()}:`
    const store = new experimental_KVCacheStore(kv, { prefix })

    const set = store.set('k', 'v', { tags: ['t'] }) // tokens read now, entry written after release
    await store.revalidate({ tags: ['t'] })
    release()
    await set

    await expect(store.get('k')).resolves.toBeUndefined()
    await expect(env.CACHE_KV.get(`${prefix}e:k`)).resolves.toBeNull()
  })
})
