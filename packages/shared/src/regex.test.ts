import { ARRAY_INDEX_REGEX, INTEGER_REGEX, TRAILING_SLASH_REGEX } from './regex.ts'

describe('TRAILING_SLASH_REGEX', () => {
  it('removes a single trailing slash only', () => {
    expect('https://example.com/'.replace(TRAILING_SLASH_REGEX, '')).toBe('https://example.com')
    expect('https://example.com//'.replace(TRAILING_SLASH_REGEX, '')).toBe('https://example.com/')
    expect('/api'.replace(TRAILING_SLASH_REGEX, '')).toBe('/api')
    expect('/'.replace(TRAILING_SLASH_REGEX, '')).toBe('')
  })
})

describe('ARRAY_INDEX_REGEX', () => {
  it.each(['0', '1', '12', '1234567890'])('matches %s', (value) => {
    expect(ARRAY_INDEX_REGEX.test(value)).toBe(true)
  })

  it.each(['', '-1', '-0', '+1', '01', '00', '1.0', '1e3', ' 1', '1 ', 'a'])(
    'does not match %j',
    (value) => {
      expect(ARRAY_INDEX_REGEX.test(value)).toBe(false)
    },
  )
})

describe('INTEGER_REGEX', () => {
  it.each(['0', '-0', '1', '-1', '12', '-12', '12345678901234567890'])('matches %s', (value) => {
    expect(INTEGER_REGEX.test(value)).toBe(true)
  })

  it.each(['', '-', '+1', '01', '-01', '1.0', '1e3', ' 1', '1 ', 'a'])(
    'does not match %j',
    (value) => {
      expect(INTEGER_REGEX.test(value)).toBe(false)
    },
  )
})
