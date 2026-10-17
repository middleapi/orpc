import type { StandardLazyResponse, StandardRequest } from '@standard-server/core'
import type { StandardLinkCodec, StandardLinkTransport } from '../adapters/standard'
import { RPCLink } from '../adapters/fetch'
import { StandardLink } from '../adapters/standard'
import { createORPCClient } from '../client'
import { CookiesManagementLinkPlugin } from './cookies-management'

function makeCodec(headers: StandardRequest['headers'] = {}): StandardLinkCodec<any> {
  return {
    encodeInput: vi.fn(async () => ({
      method: 'POST',
      url: '/test',
      headers,
      body: undefined,
    } satisfies StandardRequest)),
    decodeResponse: vi.fn(async response => ({
      kind: 'output' as const,
      output: await response.resolveBody(),
    })),
  }
}

function makeTransport(headers: StandardLazyResponse['headers'] = {}): StandardLinkTransport<any> {
  return {
    send: vi.fn(async () => ({
      status: 200,
      headers,
      resolveBody: async () => 'success',
    } satisfies StandardLazyResponse)),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('cookiesManagementLinkPlugin', () => {
  it('sets the cookie header from getCookie', async () => {
    const codec = makeCodec()
    const transport = makeTransport()
    const getCookie = vi.fn(async () => 'session=abc')

    const link = new StandardLink(codec, transport, {
      plugins: [new CookiesManagementLinkPlugin({ getCookie })],
    })

    expect(await link.call(['test'], 'input', { context: {} })).toBe('success')

    expect(getCookie).toHaveBeenCalledTimes(1)
    expect(getCookie).toHaveBeenCalledWith(expect.objectContaining({ path: ['test'], context: {} }))
    expect(vi.mocked(transport.send).mock.calls[0]![0].headers).toEqual({ cookie: 'session=abc' })
  })

  it.each([undefined, ''])('does not set the cookie header when getCookie returns %j', async (cookie) => {
    const codec = makeCodec()
    const transport = makeTransport()

    const link = new StandardLink(codec, transport, {
      plugins: [new CookiesManagementLinkPlugin({ getCookie: () => cookie })],
    })

    await link.call(['test'], 'input', { context: {} })

    expect(vi.mocked(transport.send).mock.calls[0]![0].headers).toEqual({})
  })

  it('keeps an existing cookie header', async () => {
    const codec = makeCodec({ cookie: 'explicit=1' })
    const transport = makeTransport()
    const getCookie = vi.fn(() => 'session=abc')

    const link = new StandardLink(codec, transport, {
      plugins: [new CookiesManagementLinkPlugin({ getCookie })],
    })

    await link.call(['test'], 'input', { context: {} })

    expect(getCookie).not.toHaveBeenCalled()
    expect(vi.mocked(transport.send).mock.calls[0]![0].headers).toEqual({ cookie: 'explicit=1' })
  })

  it.each([
    ['a=1', ['a=1']],
    [['a=1', 'b=2'], ['a=1', 'b=2']],
  ])('reports set-cookie %j to setCookie', async (header, expected) => {
    const codec = makeCodec()
    const transport = makeTransport({ 'set-cookie': header })
    const setCookie = vi.fn()

    const link = new StandardLink(codec, transport, {
      plugins: [new CookiesManagementLinkPlugin({ getCookie: undefined, setCookie })],
    })

    await link.call(['test'], 'input', { context: {} })

    expect(setCookie).toHaveBeenCalledTimes(1)
    expect(setCookie).toHaveBeenCalledWith(expected, expect.objectContaining({ path: ['test'], context: {} }))
  })

  it('does not call setCookie when the response sets no cookies', async () => {
    const codec = makeCodec()
    const transport = makeTransport()
    const setCookie = vi.fn()

    const link = new StandardLink(codec, transport, {
      plugins: [new CookiesManagementLinkPlugin({ getCookie: undefined, setCookie })],
    })

    await link.call(['test'], 'input', { context: {} })

    expect(setCookie).not.toHaveBeenCalled()
  })

  it('waits for setCookie before returning the output', async () => {
    const codec = makeCodec()
    const transport = makeTransport({ 'set-cookie': 'a=1' })
    const order: string[] = []

    const link = new StandardLink(codec, transport, {
      plugins: [new CookiesManagementLinkPlugin({
        getCookie: undefined,
        setCookie: async () => {
          await new Promise(resolve => setTimeout(resolve, 10))
          order.push('setCookie')
        },
      })],
    })

    await link.call(['test'], 'input', { context: {} })
    order.push('output')

    expect(order).toEqual(['setCookie', 'output'])
  })

  it('works with RPCLink and fetch', async () => {
    let jar = 'session=old'

    const fetch = vi.fn(async (_url: string, _init: RequestInit) => {
      const headers = new Headers({ 'content-type': 'application/json' })
      headers.append('set-cookie', 'session=new; Path=/; HttpOnly')
      headers.append('set-cookie', 'cache=1; Path=/')

      return new Response(JSON.stringify({ json: 'pong' }), { status: 200, headers })
    })

    const client = createORPCClient<any>(new RPCLink({
      fetch,
      origin: 'http://api.example.com',
      plugins: [
        new CookiesManagementLinkPlugin({
          getCookie: () => jar,
          setCookie: (cookies) => {
            jar = cookies.map(cookie => cookie.split(';')[0]).join('; ')
          },
        }),
      ],
    }))

    expect(await client.ping('input')).toBe('pong')
    expect(new Headers(fetch.mock.calls[0]![1].headers).get('cookie')).toBe('session=old')
    expect(jar).toBe('session=new; cache=1')

    await client.ping('input')
    expect(new Headers(fetch.mock.calls[1]![1].headers).get('cookie')).toBe('session=new; cache=1')
  })
})
