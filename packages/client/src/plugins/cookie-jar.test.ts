import type { StandardHeaders, StandardLazyResponse, StandardRequest } from '@standard-server/core'
import type { StandardLinkCodec, StandardLinkTransport } from '../adapters/standard'
import { RPCLink } from '../adapters/fetch'
import { StandardLink } from '../adapters/standard'
import { createORPCClient } from '../client'
import { BatchLinkPlugin } from './batch'
import { CookieJar, CookieJarLinkPlugin } from './cookie-jar'

function createCodec(headers: StandardHeaders = {}): StandardLinkCodec<any> {
  return {
    encodeInput: vi.fn(async (_input, path) => ({
      method: 'POST',
      url: `/rpc/${path.join('/')}`,
      headers,
      body: undefined,
    } satisfies StandardRequest)),
    decodeResponse: vi.fn(async response => ({
      kind: 'output' as const,
      output: await response.resolveBody(),
    })),
  }
}

function createTransport(...responseHeaders: StandardHeaders[]): StandardLinkTransport<any> {
  let index = 0

  return {
    send: vi.fn(async () => ({
      status: 200,
      headers: responseHeaders[index++] ?? {},
      resolveBody: async () => 'success',
    } satisfies StandardLazyResponse)),
  }
}

function sentCookie(transport: StandardLinkTransport<any>, call: number) {
  return vi.mocked(transport.send).mock.calls[call]![0].headers.cookie
}

describe('cookieJarLinkPlugin', () => {
  it('stores cookies the server sets and sends them on later requests', async () => {
    const codec = createCodec()
    const transport = createTransport(
      { 'set-cookie': ['session=abc; Path=/; HttpOnly', 'theme=dark; Path=/'] },
      { 'set-cookie': 'session=def; Path=/' },
    )

    const link = new StandardLink(codec, transport, {
      plugins: [new CookieJarLinkPlugin()],
    })

    await expect(link.call(['login'], 'input', { context: {} })).resolves.toBe('success')
    await expect(link.call(['refresh'], 'input', { context: {} })).resolves.toBe('success')
    await expect(link.call(['me'], 'input', { context: {} })).resolves.toBe('success')

    expect(sentCookie(transport, 0)).toBeUndefined()
    expect(sentCookie(transport, 1)).toBe('session=abc; theme=dark')
    expect(sentCookie(transport, 2)).toBe('session=def; theme=dark')
  })

  it('stops sending a cookie the server deletes', async () => {
    const codec = createCodec()
    const transport = createTransport(
      { 'set-cookie': 'session=abc; Path=/' },
      { 'set-cookie': 'session=; Max-Age=0; Path=/' },
    )

    const link = new StandardLink(codec, transport, {
      plugins: [new CookieJarLinkPlugin()],
    })

    await link.call(['login'], 'input', { context: {} })
    await link.call(['logout'], 'input', { context: {} })
    await link.call(['me'], 'input', { context: {} })

    expect(sentCookie(transport, 1)).toBe('session=abc')
    expect(sentCookie(transport, 2)).toBeUndefined()
  })

  it('stores cookies of error responses', async () => {
    const codec = createCodec()
    const transport: StandardLinkTransport<any> = {
      send: vi.fn(async () => ({
        status: 401,
        headers: { 'set-cookie': 'session=; Max-Age=0; Path=/' },
        resolveBody: async () => 'error',
      })),
    }
    const jar = new CookieJar()
    jar.setCookie('session=abc; Path=/', '/')

    const link = new StandardLink(codec, transport, {
      plugins: [new CookieJarLinkPlugin({ jar })],
    })

    await link.call(['me'], 'input', { context: {} })

    expect(sentCookie(transport, 0)).toBe('session=abc')
    expect(jar.getCookies()).toEqual([])
  })

  it('scopes cookies by the request path', async () => {
    const codec = createCodec()
    const transport = createTransport(
      { 'set-cookie': ['a=1', 'b=1; Path=/rpc/admin'] },
    )

    const link = new StandardLink(codec, transport, {
      plugins: [new CookieJarLinkPlugin()],
    })

    await link.call(['auth', 'login'], 'input', { context: {} })
    await link.call(['auth', 'me'], 'input', { context: {} })
    await link.call(['admin', 'users'], 'input', { context: {} })
    await link.call(['ping'], 'input', { context: {} })

    expect(sentCookie(transport, 1)).toBe('a=1')
    expect(sentCookie(transport, 2)).toBe('b=1')
    expect(sentCookie(transport, 3)).toBeUndefined()
  })

  it('matches Domain and Secure against the origin', async () => {
    const codec = createCodec()
    const transport = createTransport(
      { 'set-cookie': ['host=1; Path=/', 'domain=1; Domain=example.com; Path=/', 'secure=1; Secure; Path=/'] },
    )
    const origin = vi.fn((_options: any, path: string[]) => path[0] === 'login' ? 'https://api.example.com/' : `${path[0]}/`)

    const link = new StandardLink(codec, transport, {
      plugins: [new CookieJarLinkPlugin({ origin })],
    })

    await link.call(['login'], 'input', { context: {} })
    await link.call(['https://api.example.com'], 'input', { context: {} })
    await link.call(['http://api.example.com'], 'input', { context: {} })
    await link.call(['https://auth.example.com'], 'input', { context: {} })
    await link.call(['https://other.com'], 'input', { context: {} })

    expect(origin).toHaveBeenCalledWith(expect.objectContaining({ context: {}, path: ['login'] }), ['login'])
    expect(sentCookie(transport, 1)).toBe('host=1; domain=1; secure=1')
    expect(sentCookie(transport, 2)).toBe('host=1; domain=1')
    expect(sentCookie(transport, 3)).toBe('domain=1')
    expect(sentCookie(transport, 4)).toBeUndefined()
  })

  it('appends jar cookies to an explicit cookie header without overriding it', async () => {
    const jar = new CookieJar()
    jar.setCookie('session=jar; Path=/', '/')
    jar.setCookie('theme=dark; Path=/', '/')

    const transport = createTransport()
    const link = new StandardLink(createCodec({ cookie: 'session=explicit; lang=en' }), transport, {
      plugins: [new CookieJarLinkPlugin({ jar })],
    })

    await link.call(['ping'], 'input', { context: {} })

    expect(sentCookie(transport, 0)).toBe('session=explicit; lang=en; theme=dark')
  })

  it.each([
    [undefined, undefined],
    ['', ''],
    ['a=1', 'a=1'],
    [['a=1', 'b=2'], ['a=1', 'b=2']],
  ])('keeps the explicit cookie header %j when the jar is empty', async (cookie, expected) => {
    const transport = createTransport()
    const link = new StandardLink(createCodec({ cookie }), transport, {
      plugins: [new CookieJarLinkPlugin()],
    })

    await link.call(['ping'], 'input', { context: {} })

    expect(sentCookie(transport, 0)).toEqual(expected)
  })

  it('joins an explicit cookie header array before appending jar cookies', async () => {
    const jar = new CookieJar()
    jar.setCookie('a=jar; Path=/', '/')
    jar.setCookie('c=jar; Path=/', '/')

    const transport = createTransport()
    const link = new StandardLink(createCodec({ cookie: ['a=1', ' ', 'b=2'] }), transport, {
      plugins: [new CookieJarLinkPlugin({ jar })],
    })

    await link.call(['ping'], 'input', { context: {} })

    expect(sentCookie(transport, 0)).toBe('a=1; b=2; c=jar')
  })

  it('sends a nameless cookie as its value', async () => {
    const jar = new CookieJar()
    jar.setCookie('flag; Path=/', '/')

    const transport = createTransport()
    const link = new StandardLink(createCodec(), transport, {
      plugins: [new CookieJarLinkPlugin({ jar })],
    })

    await link.call(['ping'], 'input', { context: {} })

    expect(sentCookie(transport, 0)).toBe('flag')
  })

  it('picks the jar per request', async () => {
    const jars = { alice: new CookieJar(), bob: new CookieJar() }
    jars.alice.setCookie('session=alice; Path=/', '/')
    jars.bob.setCookie('session=bob; Path=/', '/')

    const transport = createTransport({}, { 'set-cookie': 'seen=1; Path=/' })
    const jar = vi.fn(({ context }: { context: { user: 'alice' | 'bob' } }) => jars[context.user])

    const link = new StandardLink<{ user: 'alice' | 'bob' }>(createCodec(), transport, {
      plugins: [new CookieJarLinkPlugin({ jar })],
    })

    await link.call(['ping'], 'input', { context: { user: 'alice' } })
    await link.call(['ping'], 'input', { context: { user: 'bob' } })

    expect(jar).toHaveBeenCalledWith(expect.objectContaining({ context: { user: 'alice' }, path: ['ping'] }))
    expect(sentCookie(transport, 0)).toBe('session=alice')
    expect(sentCookie(transport, 1)).toBe('session=bob')
    expect(jars.alice.getCookies().map(cookie => cookie.name)).toEqual(['session'])
    expect(jars.bob.getCookies().map(cookie => cookie.name)).toEqual(['session', 'seen'])
  })

  it('stores cookies before the call resolves', async () => {
    const jar = new CookieJar()
    const link = new StandardLink(createCodec(), createTransport({ 'set-cookie': 'a=1' }), {
      plugins: [new CookieJarLinkPlugin({ jar })],
    })

    await link.call(['ping'], 'input', { context: {} })

    expect(jar.getCookies()).toMatchObject([{ name: 'a', value: '1' }])
  })

  it('does not store cookies when the request fails', async () => {
    const jar = new CookieJar()
    jar.setCookie('a=1; Path=/', '/')

    const transport: StandardLinkTransport<any> = {
      send: vi.fn(async () => {
        throw new TypeError('Network error')
      }),
    }
    const link = new StandardLink(createCodec(), transport, {
      plugins: [new CookieJarLinkPlugin({ jar })],
    })

    await expect(link.call(['ping'], 'input', { context: {} })).rejects.toThrow('Network error')
    expect(sentCookie(transport, 0)).toBe('a=1')
    expect(jar.getCookies()).toMatchObject([{ name: 'a', value: '1' }])
  })

  it('handles cookies once per batch request', async () => {
    const jar = new CookieJar()
    jar.setCookie('session=abc; Path=/', 'https://api.example.com/')
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
      origin: 'https://api.example.com',
      plugins: [
        new CookieJarLinkPlugin({ jar, origin: 'https://api.example.com' }),
        new BatchLinkPlugin({ groups: [{ condition: () => true, context: {} }] }),
      ],
    }))

    await expect(Promise.all([client.a(), client.b(), client.c()])).resolves.toEqual(['pong', 'pong', 'pong'])

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(new Headers(fetch.mock.calls[0]![1].headers).get('cookie')).toBe('session=abc')
    expect(getCookies).toHaveBeenCalledTimes(1)
    expect(getCookies).toHaveBeenCalledWith('https://api.example.com/rpc/a/__batch__')
    expect(setCookie).toHaveBeenCalledTimes(2)
    expect(jar.getCookies().map(cookie => `${cookie.name}=${cookie.value}`)).toEqual(['session=def', 'theme=dark'])
  })

  it('works with RPCLink and fetch', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => {
      const headers = new Headers({ 'content-type': 'application/json' })
      headers.append('set-cookie', 'session=new; Path=/; HttpOnly; Secure')
      headers.append('set-cookie', 'cache=1; Path=/rpc; Max-Age=3600')

      return new Response(JSON.stringify({ json: 'pong' }), { status: 200, headers })
    })

    const jar = new CookieJar()
    jar.setCookie('session=old; Path=/', 'https://api.example.com/')

    const client = createORPCClient<any>(new RPCLink({
      fetch,
      url: '/rpc',
      origin: 'https://api.example.com',
      plugins: [
        new CookieJarLinkPlugin({ jar, origin: 'https://api.example.com' }),
      ],
    }))

    await expect(client.ping('input')).resolves.toBe('pong')
    expect(fetch.mock.calls[0]![0]).toBe('https://api.example.com/rpc/ping')
    expect(new Headers(fetch.mock.calls[0]![1].headers).get('cookie')).toBe('session=old')

    await expect(client.ping('input')).resolves.toBe('pong')
    expect(new Headers(fetch.mock.calls[1]![1].headers).get('cookie')).toBe('cache=1; session=new')
  })
})

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
