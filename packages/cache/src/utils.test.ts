import { RPCJsonSerializer } from '@orpc/client'
import { encodeCacheKey } from './utils'

describe('encodeCacheKey', () => {
  const serializer = new RPCJsonSerializer()

  it('uses string keys verbatim', () => {
    expect(encodeCacheKey('planet:1', serializer)).toBe('planet:1')
  })

  it('encodes structurally equal keys identically, regardless of property order', () => {
    expect(encodeCacheKey([['planet', 'find'], { b: 2, a: 1 }], serializer))
      .toBe(encodeCacheKey([['planet', 'find'], { a: 1, b: 2 }], serializer))

    expect(encodeCacheKey({ date: new Date(1), big: 1n }, serializer))
      .toBe(encodeCacheKey({ big: 1n, date: new Date(1) }, serializer))

    expect(encodeCacheKey({ big: 1n }, serializer)).not.toBe(encodeCacheKey({ big: 2n }, serializer))
  })

  it('ignores unsupported values like blobs', () => {
    expect(encodeCacheKey({ file: new Blob(['a']), id: 1 }, serializer))
      .toBe(encodeCacheKey({ file: new Blob(['b']), id: 1 }, serializer))
  })
})
