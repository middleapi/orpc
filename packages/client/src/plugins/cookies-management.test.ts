import type { StandardHeaders, StandardLazyResponse, StandardRequest } from '@standard-server/core'
import type { StandardLinkCodec, StandardLinkTransport } from '../adapters/standard'
import { RPCLink } from '../adapters/fetch'
import { StandardLink } from '../adapters/standard'
import { createORPCClient } from '../client'
import { BatchLinkPlugin } from './batch'
import { CookieJar } from './cookie-jar'
import { CookiesManagementLinkPlugin } from './cookies-management'

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

describe('cookiesManagementLinkPlugin', () => {
  it('stores cookies the server sets and sends them on later requests', async () => {
    const codec = createCodec()
    const transport = createTransport(
      { 'set-cookie': ['session=abc; Path=/; HttpOnly', 'theme=dark; Path=/'] },
      { 'set-cookie': 'session=def; Path=/' },
    )

    const link = new StandardLink(codec, transport, {
      plugins: [new CookiesManagementLinkPlugin()],
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
      plugins: [new CookiesManagementLinkPlugin()],
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
      plugins: [new CookiesManagementLinkPlugin({ jar })],
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
      plugins: [new CookiesManagementLinkPlugin()],
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
      plugins: [new CookiesManagementLinkPlugin({ origin })],
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
      plugins: [new CookiesManagementLinkPlugin({ jar })],
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
      plugins: [new CookiesManagementLinkPlugin()],
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
      plugins: [new CookiesManagementLinkPlugin({ jar })],
    })

    await link.call(['ping'], 'input', { context: {} })

    expect(sentCookie(transport, 0)).toBe('a=1; b=2; c=jar')
  })

  it('sends a nameless cookie as its value', async () => {
    const jar = new CookieJar()
    jar.setCookie('flag; Path=/', '/')

    const transport = createTransport()
    const link = new StandardLink(createCodec(), transport, {
      plugins: [new CookiesManagementLinkPlugin({ jar })],
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
      plugins: [new CookiesManagementLinkPlugin({ jar })],
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
      plugins: [new CookiesManagementLinkPlugin({ jar })],
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
      plugins: [new CookiesManagementLinkPlugin({ jar })],
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
        new CookiesManagementLinkPlugin({ jar, origin: 'https://api.example.com' }),
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
        new CookiesManagementLinkPlugin({ jar, origin: 'https://api.example.com' }),
      ],
    }))

    await expect(client.ping('input')).resolves.toBe('pong')
    expect(fetch.mock.calls[0]![0]).toBe('https://api.example.com/rpc/ping')
    expect(new Headers(fetch.mock.calls[0]![1].headers).get('cookie')).toBe('session=old')

    await expect(client.ping('input')).resolves.toBe('pong')
    expect(new Headers(fetch.mock.calls[1]![1].headers).get('cookie')).toBe('cache=1; session=new')
  })
})
