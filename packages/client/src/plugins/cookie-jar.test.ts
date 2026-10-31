import { CookieJar } from './cookie-jar'

function names(jar: CookieJar, url: string) {
  return jar.getCookies(url).map(cookie => cookie.name ? `${cookie.name}=${cookie.value}` : cookie.value)
}

describe('cookieJar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores a cookie and returns it for the same site', () => {
    const jar = new CookieJar()

    jar.setCookie('session=abc; Path=/; HttpOnly', 'https://example.com/rpc/login')

    expect(jar.getCookies('https://example.com/rpc/me')).toEqual([{
      name: 'session',
      value: 'abc',
      domain: 'example.com',
      hostOnly: true,
      path: '/',
      secure: false,
      expires: undefined,
    }])
    expect(jar.getCookies('https://other.com/rpc/me')).toEqual([])
  })

  it('keeps values and names as sent, trimming only whitespace', () => {
    const jar = new CookieJar()

    jar.setCookie('  token = a%20b=c ; Path=/', 'https://example.com/')
    jar.setCookie('nameless; Path=/', 'https://example.com/')

    expect(jar.getCookies('https://example.com/')).toMatchObject([
      { name: 'token', value: 'a%20b=c' },
      { name: '', value: 'nameless' },
    ])
  })

  it.each([
    '',
    '   ',
    '=',
    '; Path=/',
  ])('ignores an empty cookie: %j', (setCookie) => {
    const jar = new CookieJar()

    jar.setCookie(setCookie, 'https://example.com/')

    expect(jar.getCookies()).toEqual([])
  })

  it('replaces a cookie with the same name, domain, and path in place', () => {
    const jar = new CookieJar()

    jar.setCookie('a=1; Path=/', 'https://example.com/')
    jar.setCookie('b=1; Path=/', 'https://example.com/')
    jar.setCookie('a=2; Path=/', 'https://example.com/')
    jar.setCookie('a=3; Path=/docs', 'https://example.com/')

    expect(names(jar, 'https://example.com/docs')).toEqual(['a=3', 'a=2', 'b=1'])
  })

  it('returns longer paths first, then older cookies first', () => {
    const jar = new CookieJar()

    jar.setCookie('a=1; Path=/', 'https://example.com/')
    jar.setCookie('b=1; Path=/api/v1', 'https://example.com/')
    jar.setCookie('c=1; Path=/api', 'https://example.com/')
    jar.setCookie('d=1; Path=/', 'https://example.com/')

    expect(names(jar, 'https://example.com/api/v1/ping')).toEqual(['b=1', 'c=1', 'a=1', 'd=1'])
  })

  describe('path', () => {
    it.each([
      ['https://example.com/rpc/auth/login', '/rpc/auth'],
      ['https://example.com/rpc', '/'],
      ['https://example.com/', '/'],
      ['https://example.com/rpc/?query=/a/b', '/rpc'],
    ])('defaults to the directory of %s', (url, path) => {
      const jar = new CookieJar()

      jar.setCookie('a=1', url)

      expect(jar.getCookies()).toMatchObject([{ path }])
    })

    it.each(['', 'relative'])('uses the default path for an invalid path attribute: %j', (path) => {
      const jar = new CookieJar()

      jar.setCookie(`a=1; Path=${path}`, 'https://example.com/rpc/auth/login')

      expect(jar.getCookies()).toMatchObject([{ path: '/rpc/auth' }])
    })

    it.each([
      ['/rpc', '/rpc', true],
      ['/rpc', '/rpc/ping', true],
      ['/rpc/', '/rpc/ping', true],
      ['/rpc', '/rpcx', false],
      ['/rpc', '/', false],
      ['/rpc/ping', '/rpc', false],
    ])('matches cookie path %s against request path %s: %s', (cookiePath, requestPath, matched) => {
      const jar = new CookieJar()

      jar.setCookie(`a=1; Path=${cookiePath}`, 'https://example.com/')

      expect(jar.getCookies(`https://example.com${requestPath}`)).toHaveLength(matched ? 1 : 0)
    })
  })

  describe('domain', () => {
    it('sends a host-only cookie to the exact host only', () => {
      const jar = new CookieJar()

      jar.setCookie('a=1; Path=/', 'https://api.example.com/')

      expect(jar.getCookies('https://api.example.com/')).toHaveLength(1)
      expect(jar.getCookies('https://API.EXAMPLE.COM/')).toHaveLength(1)
      expect(jar.getCookies('https://v1.api.example.com/')).toHaveLength(0)
      expect(jar.getCookies('https://example.com/')).toHaveLength(0)
    })

    it.each(['example.com', '.example.com', 'EXAMPLE.com'])('sends a cookie with Domain=%s to the domain and its subdomains', (domain) => {
      const jar = new CookieJar()

      jar.setCookie(`a=1; Domain=${domain}; Path=/`, 'https://api.example.com/')

      expect(jar.getCookies()).toMatchObject([{ domain: 'example.com', hostOnly: false }])
      expect(jar.getCookies('https://example.com/')).toHaveLength(1)
      expect(jar.getCookies('https://auth.example.com/')).toHaveLength(1)
      expect(jar.getCookies('https://notexample.com/')).toHaveLength(0)
    })

    it.each([
      ['https://example.com/', 'other.com'],
      ['https://example.com/', 'api.example.com'],
      ['https://notexample.com/', 'example.com'],
      ['http://127.0.0.1/', '0.0.1'],
    ])('ignores a cookie from %s with Domain=%s', (url, domain) => {
      const jar = new CookieJar()

      jar.setCookie(`a=1; Domain=${domain}`, url)

      expect(jar.getCookies()).toEqual([])
    })

    it('treats an empty Domain attribute as absent', () => {
      const jar = new CookieJar()

      jar.setCookie('a=1; Domain=example.com; Domain=', 'https://example.com/')

      expect(jar.getCookies()).toMatchObject([{ domain: 'example.com', hostOnly: true }])
    })

    it('keeps cookies of different domains apart', () => {
      const jar = new CookieJar()

      jar.setCookie('session=a; Path=/', 'https://a.example.com/')
      jar.setCookie('session=b; Path=/', 'https://b.example.com/')

      expect(names(jar, 'https://a.example.com/')).toEqual(['session=a'])
      expect(names(jar, 'https://b.example.com/')).toEqual(['session=b'])
    })
  })

  describe('secure', () => {
    it('sends a secure cookie over secure connections only', () => {
      const jar = new CookieJar()

      jar.setCookie('a=1; Secure; Path=/', 'https://example.com/')

      expect(jar.getCookies('https://example.com/')).toHaveLength(1)
      expect(jar.getCookies('wss://example.com/')).toHaveLength(1)
      expect(jar.getCookies('http://example.com/')).toHaveLength(0)
    })

    it('ignores a secure cookie from an insecure origin', () => {
      const jar = new CookieJar()

      jar.setCookie('a=1; Secure', 'http://example.com/')

      expect(jar.getCookies()).toEqual([])
    })

    it.each([
      'http://localhost:3000/',
      'http://api.localhost/',
      'http://127.0.0.1/',
      'http://[::1]/',
    ])('treats %s as secure', (url) => {
      const jar = new CookieJar()

      jar.setCookie('a=1; Secure; Path=/', url)

      expect(jar.getCookies(url)).toHaveLength(1)
    })
  })

  describe('prefixes', () => {
    it.each([
      ['__Secure-a=1; Secure', 'https://example.com/', true],
      ['__secure-a=1; Secure', 'https://example.com/', true],
      ['__Secure-a=1', 'https://example.com/', false],
      ['__Host-a=1; Secure; Path=/', 'https://example.com/', true],
      ['__HOST-a=1; Secure; Path=/', 'https://example.com/', true],
      ['__Host-a=1; Path=/', 'https://example.com/', false],
      ['__Host-a=1; Secure', 'https://example.com/', false],
      ['__Host-a=1; Secure; Path=/docs', 'https://example.com/', false],
      ['__Host-a=1; Secure; Path=/; Domain=example.com', 'https://example.com/', false],
    ])('%s from %s is stored: %s', (setCookie, url, stored) => {
      const jar = new CookieJar()

      jar.setCookie(setCookie, url)

      expect(jar.getCookies()).toHaveLength(stored ? 1 : 0)
    })
  })

  describe('expiration', () => {
    it('expires a cookie after Max-Age seconds', () => {
      const jar = new CookieJar()

      jar.setCookie('a=1; Max-Age=60', 'https://example.com/')

      expect(jar.getCookies()).toMatchObject([{ expires: Date.now() + 60_000 }])

      vi.advanceTimersByTime(59_999)
      expect(jar.getCookies('https://example.com/')).toHaveLength(1)

      vi.advanceTimersByTime(1)
      expect(jar.getCookies('https://example.com/')).toHaveLength(0)
      expect(jar.getCookies()).toHaveLength(0)
    })

    it('expires a cookie at the Expires date', () => {
      const jar = new CookieJar()

      jar.setCookie('a=1; Expires=Thu, 01 Jan 2026 00:01:00 GMT', 'https://example.com/')

      expect(jar.getCookies()).toMatchObject([{ expires: Date.parse('2026-01-01T00:01:00Z') }])

      vi.setSystemTime(new Date('2026-01-01T00:01:00Z'))
      expect(jar.getCookies()).toHaveLength(0)
    })

    it('prefers Max-Age over Expires', () => {
      const jar = new CookieJar()

      jar.setCookie('a=1; Max-Age=60; Expires=Thu, 01 Jan 1970 00:00:00 GMT', 'https://example.com/')

      expect(jar.getCookies()).toMatchObject([{ expires: Date.now() + 60_000 }])
    })

    it.each(['soon', '1.5', '+5', '', '1e3'])('ignores an invalid Max-Age: %j', (maxAge) => {
      const jar = new CookieJar()

      jar.setCookie(`a=1; Max-Age=${maxAge}`, 'https://example.com/')

      expect(jar.getCookies()).toMatchObject([{ expires: undefined }])
    })

    it('ignores an invalid Expires', () => {
      const jar = new CookieJar()

      jar.setCookie('a=1; Expires=never', 'https://example.com/')

      expect(jar.getCookies()).toMatchObject([{ expires: undefined }])
    })

    it.each([
      'a=; Max-Age=0; Path=/',
      'a=; Max-Age=-1; Path=/',
      'a=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/',
    ])('deletes the stored cookie with %s', (setCookie) => {
      const jar = new CookieJar()

      jar.setCookie('a=1; Path=/', 'https://example.com/')
      jar.setCookie('b=1; Path=/', 'https://example.com/')
      jar.setCookie(setCookie, 'https://example.com/')

      expect(names(jar, 'https://example.com/')).toEqual(['b=1'])
    })

    it('does not delete a cookie of another path', () => {
      const jar = new CookieJar()

      jar.setCookie('a=1; Path=/', 'https://example.com/')
      jar.setCookie('a=; Max-Age=0; Path=/docs', 'https://example.com/')

      expect(names(jar, 'https://example.com/docs')).toEqual(['a=1'])
    })
  })

  describe('without an origin', () => {
    it('matches by path only and counts as secure', () => {
      const jar = new CookieJar()

      jar.setCookie('a=1; Secure; Path=/rpc', '/rpc/login')
      jar.setCookie('b=1; Domain=example.com; Path=/', '/rpc/login')
      jar.setCookie('c=1', '/rpc/auth/login?redirect=/')

      expect(jar.getCookies()).toMatchObject([
        { name: 'a', domain: undefined, hostOnly: true, path: '/rpc' },
        { name: 'b', domain: 'example.com', hostOnly: false, path: '/' },
        { name: 'c', domain: undefined, hostOnly: true, path: '/rpc/auth' },
      ])

      expect(names(jar, '/rpc/ping')).toEqual(['a=1', 'b=1'])
      expect(names(jar, '/rpc/auth/me?x=1')).toEqual(['c=1', 'a=1', 'b=1'])
      expect(names(jar, '/')).toEqual(['b=1'])
    })
  })

  it('returns copies of the stored cookies', () => {
    const jar = new CookieJar()

    jar.setCookie('a=1', 'https://example.com/')
    jar.getCookies()[0]!.value = 'changed'
    jar.getCookies('https://example.com/')[0]!.value = 'changed'

    expect(jar.getCookies()).toMatchObject([{ value: '1' }])
  })

  it('clears every cookie', () => {
    const jar = new CookieJar()

    jar.setCookie('a=1', 'https://a.example.com/')
    jar.setCookie('b=1', 'https://b.example.com/')
    jar.clear()

    expect(jar.getCookies()).toEqual([])
  })

  it('throws on an invalid url', () => {
    const jar = new CookieJar()

    expect(() => jar.setCookie('a=1', 'example.com/rpc')).toThrow(TypeError)
    expect(() => jar.getCookies('example.com/rpc')).toThrow(TypeError)
  })
})
