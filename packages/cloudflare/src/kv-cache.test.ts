import type { KVCacheStoreOptions } from './kv-cache'
import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { KVCacheStore } from './kv-cache'

describe('kvCacheStore', () => {
  function createTestingStore(options: Partial<KVCacheStoreOptions> = {}) {
    const prefix = `orpc-kv-cache-store-${crypto.randomUUID()}:`
    return { store: new KVCacheStore({ kv: env.CACHE_KV, prefix, ...options }), prefix }
  }

  it('round-trips outputs with tags and expiresAt, including undefined', async () => {
    const { store } = createTestingStore()

    await store.set('k', { nested: [1, 2] }, { tags: ['t'], ttl: 120_000 })

    const entry = await store.get('k')
    expect(entry!.output).toEqual({ nested: [1, 2] })
    expect(entry!.tags).toEqual(['t'])
    expect(entry!.expiresAt).toBeGreaterThan(Date.now())

    await store.set('u', undefined)
    await expect(store.get('u')).resolves.toEqual({ output: undefined, tags: [], expiresAt: undefined })
  })

  it('misses on unknown keys', async () => {
    const { store } = createTestingStore()

    await expect(store.get('unknown')).resolves.toBeUndefined()
  })

  it('preserves Date, Map, Set, BigInt, and undefined outputs', async () => {
    const { store } = createTestingStore()
    const output = {
      date: new Date('2026-01-02T03:04:05.678Z'),
      map: new Map([['a', 1]]),
      set: new Set([1, 2]),
      big: 123n,
      nothing: undefined,
    }

    await store.set('k', output)

    await expect(store.get('k')).resolves.toMatchObject({ output })
  })

  it('rejects outputs containing blobs', async () => {
    const { store } = createTestingStore()

    await expect(
      store.set('k', { file: new Blob(['x']) }),
    ).rejects.toThrow('KVCacheStore cannot cache outputs containing Blob or File values')
  })

  it('supports a custom serializer', async () => {
    const serializer = {
      stringify: vi.fn((data: unknown) => `custom:${JSON.stringify(data)}`),
      parse: vi.fn((text: string) => JSON.parse(text.slice('custom:'.length))),
    }
    const { store } = createTestingStore({ serializer })

    await store.set('k', { a: 1 })

    await expect(store.get('k')).resolves.toMatchObject({ output: { a: 1 } })
    expect(serializer.stringify).toHaveBeenCalled()
    expect(serializer.parse).toHaveBeenCalled()
  })

  it('invalidates entries by any of their tags', async () => {
    const { store } = createTestingStore()

    await store.set('multi', 'v', { tags: ['a', 'b'] })
    await store.set('other', 'v', { tags: ['c'] })

    await store.revalidateTag('a')

    await expect(store.get('multi')).resolves.toBeUndefined()
    await expect(store.get('other')).resolves.toBeDefined()
  })

  it('revalidates many tags at once', async () => {
    const { store } = createTestingStore()

    await store.set('a', 'v', { tags: ['a'] })
    await store.set('b', 'v', { tags: ['b'] })

    await store.revalidateTag(['a', 'b'])

    await expect(store.get('a')).resolves.toBeUndefined()
    await expect(store.get('b')).resolves.toBeUndefined()
  })

  it('entries set after a revalidation remain valid', async () => {
    const { store } = createTestingStore()

    await store.set('k', 'old', { tags: ['t'] })
    await store.revalidateTag('t')
    await store.set('k', 'new', { tags: ['t'] })

    await expect(store.get('k')).resolves.toMatchObject({ output: 'new' })
  })

  it('serves stale entries within the swr window, then evicts at the exact bound', async () => {
    const { store, prefix } = createTestingStore()

    // Craft envelopes directly so the test does not have to wait for real time to pass.
    const envelope = (expiresAt: number, evictAt: number) => JSON.stringify({
      output: JSON.stringify({ json: 'v' }),
      tags: [],
      tagTokens: {},
      expiresAt,
      evictAt,
    })

    await env.CACHE_KV.put(`${prefix}entry:stale`, envelope(Date.now() - 1000, Date.now() + 60_000))
    await env.CACHE_KV.put(`${prefix}entry:evicted`, envelope(Date.now() - 2000, Date.now() - 1000))

    const stale = await store.get('stale')
    expect(stale!.output).toBe('v')
    expect(stale!.expiresAt).toBeLessThanOrEqual(Date.now())

    await expect(store.get('evicted')).resolves.toBeUndefined()
    await expect(env.CACHE_KV.get(`${prefix}entry:evicted`)).resolves.toBeNull()
  })

  it('stores entries and tag tokens under the prefixed key families', async () => {
    const { store, prefix } = createTestingStore()

    await store.set('k', 'v', { tags: ['t'] })
    await store.revalidateTag('t')

    await expect(env.CACHE_KV.get(`${prefix}entry:k`)).resolves.toBeTypeOf('string')
    await expect(env.CACHE_KV.get(`${prefix}tag:t`)).resolves.toBeTypeOf('string')
  })
})
