import { decodeBase64url, encodeBase64url } from './base64url'

describe('encodeBase64url / decodeBase64url', () => {
  it('should encode and decode Uint8Array correctly', () => {
    const original = new Uint8Array([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100])
    const encoded = encodeBase64url(original)
    const decoded = decodeBase64url(encoded)

    expect(decoded).toEqual(original)
  })

  it('should produce URL-safe output without padding', () => {
    const data = new Uint8Array([255, 254, 253]) // Will produce +/= characters in regular base64
    const encoded = encodeBase64url(data)

    expect(encoded).not.toMatch(/[+/=]/)
    expect(encoded).toMatch(/^[\w-]+$/)
  })

  it('should handle empty data', () => {
    const empty = new Uint8Array([])
    const encoded = encodeBase64url(empty)
    const decoded = decodeBase64url(encoded)

    expect(encoded).toBe('')
    expect(decoded).toEqual(empty)
  })

  it('should work with TextEncoder/TextDecoder', () => {
    const text = 'Hello World'
    const encoded = encodeBase64url(new TextEncoder().encode(text))
    const decoded = decodeBase64url(encoded)

    expect(new TextDecoder().decode(decoded)).toEqual(text)
  })

  it('should handle large data without call stack overflow', () => {
    // Create a large Uint8Array (100KB)
    const largeData = new Uint8Array(100 * 1024)
    for (let i = 0; i < largeData.length; i++) {
      largeData[i] = i % 256
    }

    const encoded = encodeBase64url(largeData)
    const decoded = decodeBase64url(encoded)

    expect(decoded).toEqual(largeData)
    expect(encoded).not.toMatch(/[+/=]/) // Should still be URL-safe
  })

  it('should handle invalid input gracefully', () => {
    expect(decodeBase64url(null)).toBeUndefined()
    expect(decodeBase64url(undefined)).toBeUndefined()
    expect(decodeBase64url('invalid base64!')).toBeUndefined()
  })

  describe('canonical form', () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

    it('should decode every character of the alphabet', () => {
      const decoded = decodeBase64url(alphabet)

      expect(decoded).toBeDefined()
      expect(encodeBase64url(decoded!)).toBe(alphabet)
    })

    it.each([
      ['AA==', 'padding'],
      ['AAA=', 'padding'],
      ['AA=', 'partial padding'],
      ['AAAA====', 'excess padding'],
      ['-/8', 'raw /'],
      ['+_8', 'raw +'],
      [' AAA', 'leading whitespace'],
      ['AAA ', 'trailing whitespace'],
      ['AA A', 'embedded space'],
      ['A\tAA', 'embedded tab'],
      ['AA\nA', 'embedded newline'],
      ['A\r\nA', 'embedded CRLF'],
      ['A', 'length % 4 === 1'],
      ['AAAAA', 'length % 4 === 1'],
    ])('should reject %j (%s)', (input) => {
      expect(decodeBase64url(input)).toBeUndefined()
    })

    // The last char has 2 significant bits when length % 4 === 2, and 4 when length % 4 === 3,
    // so only 4 or 16 of the 64 possible last chars leave the unused bits zero
    it.each([
      ['A', 4],
      ['AA', 16],
      ['AAAA_', 4],
      ['AAAA-A', 16],
    ])('should accept exactly one encoding per byte sequence (prefix %j)', (prefix, expectedCount) => {
      const accepted: string[] = []

      for (const char of alphabet) {
        const input = prefix + char
        const decoded = decodeBase64url(input)

        if (decoded !== undefined) {
          // round-tripping proves no other accepted string decodes to the same bytes
          expect(encodeBase64url(decoded)).toBe(input)
          accepted.push(input)
        }
      }

      expect(accepted).toHaveLength(expectedCount)
    })
  })
})
