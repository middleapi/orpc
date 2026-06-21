import {
  matchesHttpPath,
  matchesHttpPathPrefix,
  mergeHttpPath,
  normalizeHttpPath,
  pathToHttpPath,
} from './http'

describe('pathToHttpPath', () => {
  it('produces a leading slash', () => {
    expect(pathToHttpPath([])).toBe('/')
  })

  it('joins plain segments', () => {
    expect(pathToHttpPath(['a', 'b', 'c'])).toBe('/a/b/c')
  })

  it('encodes special characters', () => {
    expect(pathToHttpPath(['hello world', 'foo&bar', '100%'])).toBe(
      '/hello%20world/foo%26bar/100%25',
    )
  })

  it('encodes slashes inside segments', () => {
    expect(pathToHttpPath(['a/b'])).toBe('/a%2Fb')
  })
})

describe('normalizeHttpPath', () => {
  it('normalizes a plain path unchanged', () => {
    expect(normalizeHttpPath('/a/b/c')).toBe('/a/b/c')
  })

  it('decodes and re-encodes an already-encoded path (idempotent)', () => {
    const path = '/hello%20world/foo%26bar'
    expect(normalizeHttpPath(path)).toBe(path)
  })

  it('re-encodes a manually percent-encoded slash in a segment', () => {
    expect(normalizeHttpPath('/a%2Fb')).toBe('/a%2Fb')
  })

  it('handles malformed percent sequences gracefully', () => {
    // tryDecodeURIComponent falls back to the raw string on failure
    expect(normalizeHttpPath('/bad%GGvalue')).toBe('/bad%25GGvalue')
  })

  it('handles paths with no leading slash', () => {
    expect(normalizeHttpPath('a/b')).toBe('/a/b')
  })

  it('canonicalizes redundant percent-encoding', () => {
    // '%54' → 'T', '%41' → 'A'
    // Safe characters are emitted in their decoded form
    expect(normalizeHttpPath('/%54est/%41BC')).toBe('/Test/ABC')
  })

  it('can handle single slash', () => {
    expect(normalizeHttpPath('/')).toEqual('/')
  })

  it('does not remove redundant trailing slash', () => {
    expect(normalizeHttpPath('/a/')).toEqual('/a/')
  })
})

describe('mergeHttpPath', () => {
  it('joins two simple paths', () => {
    expect(mergeHttpPath('/api', '/users')).toBe('/api/users')
  })

  it('joins root with a path', () => {
    expect(mergeHttpPath('/', '/users')).toBe('/users')
  })

  it('joins a path with root', () => {
    expect(mergeHttpPath('/api', '/')).toBe('/api/')
  })

  it('strips trailing slash from `a` before joining', () => {
    expect(mergeHttpPath('/api/', '/users')).toBe('/api/users')
  })

  it('does not double-strip — only removes one trailing slash', () => {
    expect(mergeHttpPath('/api//', '/users')).toBe('/api//users')
  })

  it('handles nested segments in `a`', () => {
    expect(mergeHttpPath('/api/v1', '/users')).toBe('/api/v1/users')
  })

  it('handles nested segments in `b`', () => {
    expect(mergeHttpPath('/api', '/users/123')).toBe('/api/users/123')
  })

  it('handles nested segments in both', () => {
    expect(mergeHttpPath('/api/v2', '/users/profile')).toBe('/api/v2/users/profile')
  })
})

describe('matchesHttpPathPrefix', () => {
  it.each([
    ['/api/users', '/api', true, 'matches nested path segments'],
    ['/api?foo=bar', '/api', true, 'matches query strings'],
    ['/api#section', '/api', true, 'matches hash fragments'],
    ['/api', '/api', true, 'matches exact path'],
    ['/api', '/', true, 'matches prefix is signal slash'],
    ['/api/users', '/api/', true, 'allows prefixes with trailing slash'],
    ['/apiary', '/api', false, 'rejects partial segment matches'],
    ['/other/api', '/api', false, 'rejects non-prefix paths'],
  ] as const)('returns %s for url=%s prefix=%s (%s)', (url, prefix, expected, _description) => {
    expect(matchesHttpPathPrefix(url, prefix)).toBe(expected)
  })
})

describe('matchesHttpPath', () => {
  it.each([
    ['/api', '/api', true, 'matches exact path'],
    ['/api', '/api/', true, 'matches path with end slash'],
    ['/', '/', true, 'matches empty'],
    ['/api?foo=bar', '/api', true, 'matches query strings'],
    ['/api#section', '/api', true, 'matches hash fragments'],
    ['/api/', '/api', true, 'matches trailing slash path variants'],
    ['/api/users', '/api', false, 'rejects longer paths 1'],
    ['/api/users', '/', false, 'rejects longer paths 2'],
    ['/apiary', '/api', false, 'rejects partial segment matches'],
    ['/other/api', '/api', false, 'rejects non-prefix paths'],
  ] as const)('returns %s for url=%s path=%s (%s)', (url, path, expected, _description) => {
    expect(matchesHttpPath(url, path)).toBe(expected)
  })
})
