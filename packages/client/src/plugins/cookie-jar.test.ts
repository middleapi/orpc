import type { StandardHeaders, StandardLazyResponse } from '@standard-server/core'
import type { StandardLinkCodec, StandardLinkTransport } from '../adapters/standard'
import type { CookieJarLinkPluginOptions } from './cookie-jar'
import { RPCLink } from '../adapters/fetch'
import { StandardLink } from '../adapters/standard'
import { createORPCClient } from '../client'
import { BatchLinkPlugin } from './batch'
import { CookieJar, CookieJarLinkPlugin } from './cookie-jar'

const origin = 'https://api.example.com'

function createTransport(...responses: Partial<StandardLazyResponse>[]): StandardLinkTransport<any> {
  let index = 0

  return {
    send: vi.fn(async () => ({ status: 200, headers: {}, resolveBody: async () => 'success', ...responses[index++] })),
  }
}

function createLink(options: Partial<CookieJarLinkPluginOptions<any>> = {}, transport = createTransport(), headers: StandardHeaders = {}) {
  const codec: StandardLinkCodec<any> = {
    encodeInput: async (_input, path) => ({ method: 'POST', url: `/rpc/${path.join('/')}`, headers }),
    decodeResponse: async response => ({ kind: 'output', output: await response.resolveBody() }),
  }

  return new StandardLink(codec, transport, {
    plugins: [new CookieJarLinkPlugin({ origin, ...options })],
  })
}

function sentCookie(transport: StandardLinkTransport<any>, call: number) {
  return vi.mocked(transport.send).mock.calls[call]![0].headers.cookie
}

function pairs(jar: CookieJar, url?: string) {
  return jar.getCookies(url).map(cookie => `${cookie.name}=${cookie.value}`)
}

describe('cookieJarLinkPlugin', () => {
  it('stores the cookies the server sets and sends them on later requests', async () => {
    const transport = createTransport(
      { headers: { 'set-cookie': ['session=abc; Path=/; HttpOnly', 'theme=dark; Path=/'] } },
      { headers: { 'set-cookie': 'session=def; Path=/' } },
      { headers: { 'set-cookie': 'session=; Max-Age=0; Path=/' } },
    )
    const link = createLink({}, transport)

    for (const path of ['login', 'refresh', 'logout', 'me']) {
      await expect(link.call([path], 'input', { context: {} })).resolves.toBe('success')
    }

    expect(sentCookie(transport, 0)).toBeUndefined()
    expect(sentCookie(transport, 1)).toBe('session=abc; theme=dark')
    expect(sentCookie(transport, 2)).toBe('session=def; theme=dark')
    expect(sentCookie(transport, 3)).toBe('theme=dark')
  })

  it('stores the cookies of error responses', async () => {
    const jar = new CookieJar()
    jar.setCookie('session=abc; Path=/', origin)
    const transport = createTransport({ status: 401, headers: { 'set-cookie': 'session=; Max-Age=0; Path=/' } })

    await createLink({ jar }, transport).call(['me'], 'input', { context: {} })

    expect(sentCookie(transport, 0)).toBe('session=abc')
    expect(jar.getCookies()).toEqual([])
  })

  it('matches Domain and Secure against the origin', async () => {
    const transport = createTransport({
      headers: { 'set-cookie': ['host=1; Path=/', 'domain=1; Domain=example.com; Path=/', 'secure=1; Secure; Path=/'] },
    })
    const getOrigin = vi.fn(({ context }: { context: { origin: string } }) => context.origin)
    const link = createLink({ origin: getOrigin }, transport)

    for (const requestOrigin of ['https://api.example.com/', 'https://api.example.com', 'http://api.example.com', 'https://auth.example.com', 'https://other.com']) {
      await link.call(['ping'], 'input', { context: { origin: requestOrigin } })
    }

    expect(getOrigin).toHaveBeenCalledWith(expect.objectContaining({ context: { origin: 'https://api.example.com/' }, path: ['ping'] }), ['ping'])
    expect(sentCookie(transport, 1)).toBe('host=1; domain=1; secure=1')
    expect(sentCookie(transport, 2)).toBe('host=1; domain=1')
    expect(sentCookie(transport, 3)).toBe('domain=1')
    expect(sentCookie(transport, 4)).toBeUndefined()
  })

  it('does nothing when the origin resolves to undefined', async () => {
    const jar = new CookieJar()
    jar.setCookie('session=abc; Path=/', origin)
    const transport = createTransport({ headers: { 'set-cookie': 'theme=dark; Path=/' } })

    await createLink({ jar, origin: undefined }, transport).call(['ping'], 'input', { context: {} })

    expect(sentCookie(transport, 0)).toBeUndefined()
    expect(pairs(jar)).toEqual(['session=abc'])
  })

  it.each([
    [undefined, [], undefined],
    ['', [], ''],
    [['a=1', 'b=2'], [], ['a=1', 'b=2']],
    [undefined, ['a=1', 'flag'], 'a=1; flag'],
    ['session=explicit; lang=en', ['session=jar', 'theme=dark'], 'session=explicit; lang=en; theme=dark'],
    [['a=1', ' ', 'b=2'], ['a=jar', 'c=jar'], 'a=1; b=2; c=jar'],
  ])('sends cookie header %j with jar cookies %j as %j', async (cookie, jarCookies, expected) => {
    const jar = new CookieJar()
    jarCookies.forEach(jarCookie => jar.setCookie(`${jarCookie}; Path=/`, origin))
    const transport = createTransport()

    await createLink({ jar }, transport, { cookie }).call(['ping'], 'input', { context: {} })

    expect(sentCookie(transport, 0)).toEqual(expected)
  })

  it('picks the jar per request', async () => {
    const jars = { alice: new CookieJar(), bob: new CookieJar() }
    jars.alice.setCookie('session=alice; Path=/', origin)
    jars.bob.setCookie('session=bob; Path=/', origin)

    const transport = createTransport({}, { headers: { 'set-cookie': 'seen=1; Path=/' } })
    const jar = vi.fn(({ context }: { context: { user: 'alice' | 'bob' } }) => jars[context.user])
    const link = createLink({ jar }, transport)

    await link.call(['ping'], 'input', { context: { user: 'alice' } })
    await link.call(['ping'], 'input', { context: { user: 'bob' } })

    expect(jar).toHaveBeenCalledWith(expect.objectContaining({ context: { user: 'alice' }, path: ['ping'] }))
    expect(sentCookie(transport, 0)).toBe('session=alice')
    expect(sentCookie(transport, 1)).toBe('session=bob')
    expect(pairs(jars.alice)).toEqual(['session=alice'])
    expect(pairs(jars.bob)).toEqual(['session=bob', 'seen=1'])
  })

  it('handles cookies once per batch request', async () => {
    const jar = new CookieJar()
    jar.setCookie('session=abc; Path=/', origin)
    const setCookie = vi.spyOn(jar, 'setCookie')
    const getCookies = vi.spyOn(jar, 'getCookies')

    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const messages = JSON.parse(init.body as string) as { id: string }[]
      const headers = new Headers({ 'content-type': 'application/json' })
      headers.append('set-cookie', 'session=def; Path=/')
      headers.append('set-cookie', 'theme=dark; Path=/')

      return new Response(JSON.stringify(messages.map(({ id }) => ({
        id,
        kind: 'response',
        json: { status: 200, body: { json: 'pong' } },
      }))), { status: 200, headers })
    })

    const client = createORPCClient<any>(new RPCLink({
      fetch,
      url: '/rpc',
      origin,
      plugins: [
        new CookieJarLinkPlugin({ jar, origin }),
        new BatchLinkPlugin({ groups: [{ condition: () => true, context: {} }] }),
      ],
    }))

    await expect(Promise.all([client.a(), client.b(), client.c()])).resolves.toEqual(['pong', 'pong', 'pong'])

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(new Headers(fetch.mock.calls[0]![1].headers).get('cookie')).toBe('session=abc')
    expect(getCookies).toHaveBeenCalledTimes(1)
    expect(getCookies).toHaveBeenCalledWith('https://api.example.com/rpc/a/__batch__')
    expect(setCookie).toHaveBeenCalledTimes(2)
    expect(pairs(jar)).toEqual(['session=def', 'theme=dark'])
  })
})

describe('cookieJar', () => {
  const site = 'https://example.com/'
  let jar: CookieJar

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    jar = new CookieJar()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores a cookie and returns it for the same site', () => {
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

  it('keeps names and values as sent, trimming only whitespace', () => {
    jar.setCookie('  token = a%20b=c ; Path=/', site)
    jar.setCookie('nameless; Path=/', site)

    expect(jar.getCookies(site)).toMatchObject([
      { name: 'token', value: 'a%20b=c' },
      { name: '', value: 'nameless' },
    ])
  })

  it.each(['', '   ', '=', '; Path=/'])('ignores an empty cookie: %j', (setCookie) => {
    jar.setCookie(setCookie, site)

    expect(jar.getCookies()).toEqual([])
  })

  it('replaces a cookie with the same name, domain, and path in place', () => {
    jar.setCookie('a=1; Path=/', site)
    jar.setCookie('b=1; Path=/', site)
    jar.setCookie('a=2; Path=/', site)
    jar.setCookie('a=3; Path=/docs', site)

    expect(pairs(jar, 'https://example.com/docs')).toEqual(['a=3', 'a=2', 'b=1'])
  })

  it('returns longer paths first, then older cookies first', () => {
    jar.setCookie('a=1; Path=/', site)
    jar.setCookie('b=1; Path=/api/v1', site)
    jar.setCookie('c=1; Path=/api', site)
    jar.setCookie('d=1; Path=/', site)

    expect(pairs(jar, 'https://example.com/api/v1/ping')).toEqual(['b=1', 'c=1', 'a=1', 'd=1'])
  })

  describe('path', () => {
    it.each([
      ['https://example.com/rpc/auth/login', '/rpc/auth'],
      ['https://example.com/rpc', '/'],
      ['https://example.com/', '/'],
      ['https://example.com/rpc/?query=/a/b', '/rpc'],
    ])('defaults to the directory of %s', (url, path) => {
      jar.setCookie('a=1', url)

      expect(jar.getCookies()).toMatchObject([{ path }])
    })

    it.each(['', 'relative'])('uses the default path for an invalid Path attribute: %j', (path) => {
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
      jar.setCookie(`a=1; Path=${cookiePath}`, site)

      expect(jar.getCookies(`https://example.com${requestPath}`)).toHaveLength(matched ? 1 : 0)
    })
  })

  describe('domain', () => {
    it('sends a host-only cookie to the exact host only', () => {
      jar.setCookie('a=1; Path=/', 'https://api.example.com/')

      expect(jar.getCookies('https://api.example.com/')).toHaveLength(1)
      expect(jar.getCookies('https://API.EXAMPLE.COM/')).toHaveLength(1)
      expect(jar.getCookies('https://v1.api.example.com/')).toHaveLength(0)
      expect(jar.getCookies('https://example.com/')).toHaveLength(0)
    })

    it.each(['example.com', '.example.com', 'EXAMPLE.com'])('sends a cookie with Domain=%s to the domain and its subdomains', (domain) => {
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
      jar.setCookie(`a=1; Domain=${domain}`, url)

      expect(jar.getCookies()).toEqual([])
    })

    it('treats an empty Domain attribute as absent', () => {
      jar.setCookie('a=1; Domain=example.com; Domain=', site)

      expect(jar.getCookies()).toMatchObject([{ domain: 'example.com', hostOnly: true }])
    })

    it('keeps cookies of different hosts apart', () => {
      jar.setCookie('session=a; Path=/', 'https://a.example.com/')
      jar.setCookie('session=b; Path=/', 'https://b.example.com/')

      expect(pairs(jar, 'https://a.example.com/')).toEqual(['session=a'])
      expect(pairs(jar, 'https://b.example.com/')).toEqual(['session=b'])
    })
  })

  describe('secure', () => {
    it('sends a secure cookie over secure connections only', () => {
      jar.setCookie('a=1; Secure; Path=/', site)

      expect(jar.getCookies(site)).toHaveLength(1)
      expect(jar.getCookies('wss://example.com/')).toHaveLength(1)
      expect(jar.getCookies('http://example.com/')).toHaveLength(0)
    })

    it('ignores a secure cookie from an insecure origin', () => {
      jar.setCookie('a=1; Secure', 'http://example.com/')

      expect(jar.getCookies()).toEqual([])
    })

    it.each([
      'http://localhost:3000/',
      'http://api.localhost/',
      'http://127.0.0.1/',
      'http://[::1]/',
    ])('treats %s as secure', (url) => {
      jar.setCookie('a=1; Secure; Path=/', url)

      expect(jar.getCookies(url)).toHaveLength(1)
    })
  })

  it.each([
    ['__Secure-a=1; Secure', true],
    ['__secure-a=1; Secure', true],
    ['__Secure-a=1', false],
    ['__Host-a=1; Secure; Path=/', true],
    ['__HOST-a=1; Secure; Path=/', true],
    ['__Host-a=1; Path=/', false],
    ['__Host-a=1; Secure', false],
    ['__Host-a=1; Secure; Path=/docs', false],
    ['__Host-a=1; Secure; Path=/; Domain=example.com', false],
  ])('applies the cookie prefix rules to %s: stored %s', (setCookie, stored) => {
    jar.setCookie(setCookie, site)

    expect(jar.getCookies()).toHaveLength(stored ? 1 : 0)
  })

  describe('expiration', () => {
    it('expires a cookie after Max-Age seconds', () => {
      jar.setCookie('a=1; Max-Age=60', site)

      expect(jar.getCookies()).toMatchObject([{ expires: Date.now() + 60_000 }])

      vi.advanceTimersByTime(59_999)
      expect(jar.getCookies(site)).toHaveLength(1)

      vi.advanceTimersByTime(1)
      expect(jar.getCookies()).toHaveLength(0)
    })

    it('expires a cookie at the Expires date', () => {
      jar.setCookie('a=1; Expires=Thu, 01 Jan 2026 00:01:00 GMT', site)

      expect(jar.getCookies()).toMatchObject([{ expires: Date.parse('2026-01-01T00:01:00Z') }])

      vi.setSystemTime(new Date('2026-01-01T00:01:00Z'))
      expect(jar.getCookies()).toHaveLength(0)
    })

    it('prefers Max-Age over Expires', () => {
      jar.setCookie('a=1; Max-Age=60; Expires=Thu, 01 Jan 1970 00:00:00 GMT', site)

      expect(jar.getCookies()).toMatchObject([{ expires: Date.now() + 60_000 }])
    })

    it.each([
      'Max-Age=soon',
      'Max-Age=1.5',
      'Max-Age=+5',
      'Max-Age=',
      'Max-Age=1e3',
      'Expires=never',
    ])('ignores an invalid %s', (attribute) => {
      jar.setCookie(`a=1; ${attribute}`, site)

      expect(jar.getCookies()).toMatchObject([{ expires: undefined }])
    })

    it.each([
      'a=; Max-Age=0; Path=/',
      'a=; Max-Age=-1; Path=/',
      'a=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/',
    ])('deletes the stored cookie with %s', (setCookie) => {
      jar.setCookie('a=1; Path=/', site)
      jar.setCookie('b=1; Path=/', site)
      jar.setCookie(setCookie, site)

      expect(pairs(jar, site)).toEqual(['b=1'])
    })

    it('does not delete a cookie of another path', () => {
      jar.setCookie('a=1; Path=/', site)
      jar.setCookie('a=; Max-Age=0; Path=/docs', site)

      expect(pairs(jar, 'https://example.com/docs')).toEqual(['a=1'])
    })
  })

  it('returns copies of the stored cookies', () => {
    jar.setCookie('a=1', site)
    jar.getCookies()[0]!.value = 'changed'
    jar.getCookies(site)[0]!.value = 'changed'

    expect(jar.getCookies()).toMatchObject([{ value: '1' }])
  })

  it('clears every cookie', () => {
    jar.setCookie('a=1', 'https://a.example.com/')
    jar.setCookie('b=1', 'https://b.example.com/')
    jar.clear()

    expect(jar.getCookies()).toEqual([])
  })

  it.each(['/rpc', 'example.com/rpc'])('throws on a URL without an origin: %s', (url) => {
    expect(() => jar.setCookie('a=1', url)).toThrow(TypeError)
    expect(() => jar.getCookies(url)).toThrow(TypeError)
  })
})
