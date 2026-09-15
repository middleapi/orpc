import { safeDecodeURIComponent, safeEncodeURIComponent } from './uri'

describe('safeEncodeURIComponent', () => {
  it('matches encodeURIComponent for well-formed input', () => {
    for (const value of ['', 'test', 'a b', '/?#&=+', 'a-_.!~*\'()b', 'xin chào thế giới', '😀', '😀']) {
      expect(safeEncodeURIComponent(value)).toBe(encodeURIComponent(value))
    }
  })

  it('matches encodeURIComponent for every BMP code point outside the surrogate range', () => {
    for (let code = 0; code <= 0xFFFF; code++) {
      if (code >= 0xD800 && code <= 0xDFFF) {
        continue
      }

      const value = String.fromCharCode(code)
      expect(safeEncodeURIComponent(value)).toBe(encodeURIComponent(value))
    }
  })

  it('encodes lone surrogates as U+FFFD instead of throwing', () => {
    expect(() => encodeURIComponent('\uD800')).toThrow(URIError)

    expect(safeEncodeURIComponent('\uD800')).toBe('%EF%BF%BD')
    expect(safeEncodeURIComponent('\uDC00')).toBe('%EF%BF%BD')
    expect(safeEncodeURIComponent('a\uD800b')).toBe('a%EF%BF%BDb')
    expect(safeEncodeURIComponent('a\uDC00b')).toBe('a%EF%BF%BDb')
    // a valid pair next to a lone surrogate stays intact
    expect(safeEncodeURIComponent('😀\uD83D')).toBe('%F0%9F%98%80%EF%BF%BD')
    expect(safeEncodeURIComponent('\uDE00😀')).toBe('%EF%BF%BD%F0%9F%98%80')
    expect(safeEncodeURIComponent('\uDC00\uD800')).toBe('%EF%BF%BD%EF%BF%BD')
  })
})

describe('safeDecodeURIComponent', () => {
  it('decodes valid input', () => {
    expect(safeDecodeURIComponent('test%20value')).toBe('test value')
    expect(safeDecodeURIComponent('a%2Fb')).toBe('a/b')
    expect(safeDecodeURIComponent('%E2%9C%93')).toBe('✓')
    expect(safeDecodeURIComponent('%F0%9F%98%80')).toBe('😀')
  })

  it('returns input without a percent sign as is', () => {
    for (const value of ['', 'test', 'xin chào', 'a+b']) {
      expect(safeDecodeURIComponent(value)).toBe(value)
    }
  })

  it('returns malformed input unchanged instead of throwing', () => {
    expect(() => decodeURIComponent('%')).toThrow(URIError)

    expect(safeDecodeURIComponent('%')).toBe('%')
    expect(safeDecodeURIComponent('%GG')).toBe('%GG')
    expect(safeDecodeURIComponent('invalid%20value%')).toBe('invalid%20value%')
    expect(safeDecodeURIComponent('%E0%A4%A')).toBe('%E0%A4%A') // truncated UTF-8 sequence
    expect(safeDecodeURIComponent('%FF')).toBe('%FF') // invalid UTF-8 byte
    expect(safeDecodeURIComponent('%ED%A0%80')).toBe('%ED%A0%80') // UTF-8 encoded surrogate
  })
})
