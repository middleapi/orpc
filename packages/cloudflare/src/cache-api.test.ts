import type { CloudflareCacheApiCacheStoreOptions } from './cache-api'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudflareCacheApiCacheStore } from './cache-api'

describe('cloudflareCacheApiCacheStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function createTestingStore(options: CloudflareCacheApiCacheStoreOptions = {}) {
    const baseUrl = `https://example.com/__orpc/cache/${crypto.randomUUID()}`

    const store = new CloudflareCacheApiCacheStore({
      baseUrl,
      zoneId: 'zone-1',
      apiToken: 'token-1',
      ...options,
    })

    return { store, baseUrl }
  }

  function stubPurgeApi(...responses: object[]) {
    const fetchFn = vi.fn<typeof fetch>()
    for (const response of responses) {
      fetchFn.mockResolvedValueOnce(Response.json(response))
    }
    vi.stubGlobal('fetch', fetchFn)
    return fetchFn
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
    ).rejects.toThrow('CloudflareCacheApiCacheStore cannot cache outputs containing Blob or File values')
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

  it('stores entries with encoded Cache-Tag headers and second-based retention', async () => {
    const { store, baseUrl } = createTestingStore()

    await store.set('k', 'v', { tags: ['a,b', 'planets'], ttl: 1000, swr: 500 })

    const stored = await caches.default.match(`${baseUrl}/k`)
    expect(stored!.headers.get('cache-tag')).toBe('a%2Cb,planets')
    expect(stored!.headers.get('cache-control')).toBe('public, s-maxage=2')

    await store.set('forever', 'v')

    const foreverStored = await caches.default.match(`${baseUrl}/forever`)
    expect(foreverStored!.headers.get('cache-tag')).toBe(null)
    expect(foreverStored!.headers.get('cache-control')).toBe('public, s-maxage=31536000')
  })

  it('serves stale entries within the swr window, then evicts at the exact bound', async () => {
    const { store, baseUrl } = createTestingStore()

    const envelope = (expiresAt: number, evictAt: number) => new Response(
      JSON.stringify({ output: JSON.stringify({ json: 'v' }), tags: [], expiresAt, evictAt }),
      { headers: { 'cache-control': 'public, s-maxage=3600' } },
    )

    await caches.default.put(`${baseUrl}/stale`, envelope(Date.now() - 1000, Date.now() + 60_000))
    await caches.default.put(`${baseUrl}/evicted`, envelope(Date.now() - 2000, Date.now() - 1000))

    const stale = await store.get('stale')
    expect(stale!.output).toBe('v')
    expect(stale!.expiresAt).toBeLessThanOrEqual(Date.now())

    await expect(store.get('evicted')).resolves.toBeUndefined()
    await expect(caches.default.match(`${baseUrl}/evicted`)).resolves.toBeUndefined()
  })

  it('purges tags zone-wide through the purge API', async () => {
    const { store } = createTestingStore()
    const fetchFn = stubPurgeApi({ success: true })

    await store.revalidateTag(['planets', 'a,b'])

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn).toHaveBeenCalledWith('https://api.cloudflare.com/client/v4/zones/zone-1/purge_cache', {
      method: 'POST',
      headers: {
        'authorization': 'Bearer token-1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ tags: ['planets', 'a%2Cb'] }),
    })
  })

  it('splits large purges into batches of 100 tags', async () => {
    const { store } = createTestingStore()
    const fetchFn = stubPurgeApi({ success: true }, { success: true })

    await store.revalidateTag(Array.from({ length: 150 }, (_, i) => `tag-${i}`) as [string, ...string[]])

    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchFn.mock.calls[0]![1]!.body as string).tags).toHaveLength(100)
    expect(JSON.parse(fetchFn.mock.calls[1]![1]!.body as string).tags).toHaveLength(50)
  })

  it('throws when the purge API reports a failure', async () => {
    const { store } = createTestingStore()
    stubPurgeApi({ success: false, errors: [{ message: 'Invalid API token' }] })

    await expect(store.revalidateTag('planets')).rejects.toThrow(
      'CloudflareCacheApiCacheStore failed to purge tags (status 200): Invalid API token',
    )
  })
})
