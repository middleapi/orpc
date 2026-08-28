import { encodeCacheKey } from './utils'

describe('encodeCacheKey', () => {
  it('uses string keys verbatim', () => {
    expect(encodeCacheKey('planet:1')).toBe('planet:1')
  })

  it('encodes structurally equal keys identically, regardless of property order', () => {
    expect(encodeCacheKey([['planet', 'find'], { b: 2, a: 1 }]))
      .toBe(encodeCacheKey([['planet', 'find'], { a: 1, b: 2 }]))

    expect(encodeCacheKey({ date: new Date(1), big: 1n }))
      .toBe(encodeCacheKey({ big: 1n, date: new Date(1) }))

    expect(encodeCacheKey({ big: 1n })).not.toBe(encodeCacheKey({ big: 2n }))
  })

  it('ignores unsupported values like blobs', () => {
    expect(encodeCacheKey({ file: new Blob(['a']), id: 1 }))
      .toBe(encodeCacheKey({ file: new Blob(['b']), id: 1 }))
  })
})
