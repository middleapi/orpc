import { RPCJsonSerializer } from '@orpc/client'

import { createCacheEntry, encodeCacheKey, resolveCacheExpiry } from './utils'

describe('encodeCacheKey', () => {
  const serializer = new RPCJsonSerializer()

  it('uses string keys verbatim', () => {
    expect(encodeCacheKey('planet:1', serializer)).toBe('planet:1')
    expect(encodeCacheKey('{', serializer)).toBe('{')
  })

  it('serializes strings shaped like a serialized key, so they never collide with one', () => {
    const encoded = encodeCacheKey({ a: 1 }, serializer)

    expect(encoded).toMatch(/^\{.*\}$/)
    expect(encodeCacheKey(encoded, serializer)).not.toBe(encoded)
    expect(encodeCacheKey('{}', serializer)).not.toBe('{}')
  })

  it('encodes structurally equal keys identically, regardless of property order', () => {
    expect(encodeCacheKey([['planet', 'find'], { b: 2, a: 1 }], serializer)).toBe(
      encodeCacheKey([['planet', 'find'], { a: 1, b: 2 }], serializer),
    )

    expect(encodeCacheKey({ date: new Date(1), big: 1n }, serializer)).toBe(
      encodeCacheKey({ big: 1n, date: new Date(1) }, serializer),
    )

    expect(encodeCacheKey({ big: 1n }, serializer)).not.toBe(
      encodeCacheKey({ big: 2n }, serializer),
    )
  })

  it('throws on blobs', () => {
    expect(() => encodeCacheKey({ file: new Blob(['a']), id: 1 }, serializer)).toThrow(
      'Cache keys cannot contain Blob or File values',
    )
  })
})

describe('resolveCacheExpiry', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('never expires without a ttl', () => {
    expect(resolveCacheExpiry({ swr: 500 })).toEqual({
      expiresAt: undefined,
      evictAt: undefined,
      retention: undefined,
    })
  })

  it('resolves the lifetime from ttl and swr', () => {
    expect(resolveCacheExpiry({ ttl: 500 })).toEqual({
      expiresAt: 1500,
      evictAt: 1500,
      retention: 500,
    })
    expect(resolveCacheExpiry({ ttl: 500, swr: 250 })).toEqual({
      expiresAt: 1500,
      evictAt: 1750,
      retention: 750,
    })
  })

  it('rounds the retention up to whole milliseconds', () => {
    expect(resolveCacheExpiry({ ttl: 0.5, swr: 0.25 }).retention).toBe(1)
    expect(resolveCacheExpiry({ ttl: 0 }).retention).toBe(0)
  })
})

describe('createCacheEntry', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('builds the entry with its lifetime and retention', () => {
    expect(createCacheEntry('v', { tags: ['t'], ttl: 500, swr: 250 })).toEqual({
      entry: { output: 'v', tags: ['t'], expiresAt: 1500, evictAt: 1750 },
      retention: 750,
    })
  })

  it('leaves tags absent when there are none', () => {
    expect(createCacheEntry('v', { tags: [] })).toEqual({
      entry: { output: 'v', tags: undefined, expiresAt: undefined, evictAt: undefined },
      retention: undefined,
    })
    expect(createCacheEntry('v', {}).entry.tags).toBeUndefined()
  })
})
