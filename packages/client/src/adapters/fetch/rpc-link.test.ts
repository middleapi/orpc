import { toFetchBody } from '@standardserver/fetch'
import { createORPCClient } from '../../client'
import { RPCLink } from './rpc-link'

vi.mock('@standardserver/fetch', async (loadOrigin) => {
  const origin = await loadOrigin() as any

  return {
    ...origin,
    toFetchBody: vi.fn(origin.toFetchBody),
  }
})

describe('rpcLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls endpoint with fetch transport', async () => {
    const fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ json: 'pong' }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      })
    })

    const orpc = createORPCClient(new RPCLink({
      fetch,
      origin: 'http://api.example.com',
    })) as any

    await expect(orpc.ping('input')).resolves.toEqual('pong')

    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(
      'http://api.example.com/ping',
      expect.objectContaining({
        method: 'POST',
        redirect: 'manual',
      }),
      expect.objectContaining({
        context: {},
      }),
      ['ping'],
    )
  })

  it('supports custom headers and query parameters in origin', async () => {
    const fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ json: 'pong' }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      })
    })

    const headers = vi.fn(() => ({ 'x-custom-header': 'value' }))

    const orpc = createORPCClient(new RPCLink({
      fetch,
      origin: 'http://api.example.com/api?token=abc',
      headers,
    })) as any

    await expect(orpc.ping('input')).resolves.toEqual('pong')

    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('http://api.example.com/api?token=abc'),
      expect.objectContaining({
        method: 'POST',
        redirect: 'manual',
        headers: expect.toSatisfy((h: Headers) => h.get('x-custom-header') === 'value'),
      }),
      expect.objectContaining({
        context: {},
      }),
      ['ping'],
    )
  })

  it('uses default global fetch when fetch option is not provided', async ({ onTestFinished }) => {
    const fetchSpy = vi.fn(async () => {
      return new Response(JSON.stringify({ json: 'pong' }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      })
    })

    const originalFetch = globalThis.fetch
    ;(globalThis as any).fetch = fetchSpy

    onTestFinished(() => {
      globalThis.fetch = originalFetch
    })

    const orpc = createORPCClient(new RPCLink({
      origin: 'http://api.example.com/',
    })) as any

    await expect(orpc.ping('input')).resolves.toEqual('pong')

    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://api.example.com/ping',
      expect.objectContaining({
        method: 'POST',
        redirect: 'manual',
      }),
      expect.objectContaining({
        context: {},
      }),
      ['ping'],
    )
  })

  it('supports transport interceptors and toFetchBodyOptions', async () => {
    const fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ json: 'pong' }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      })
    })

    const fetchInterceptor = vi.fn(({ next }) => next())

    const toFetchBodyOptions = { eventStream: { keepAlive: { enabled: true, comment: 'ok' } } }

    const orpc = createORPCClient(new RPCLink({
      fetch,
      origin: 'http://api.example.com',
      fetchInterceptors: [fetchInterceptor],
      toFetchBody: toFetchBodyOptions,
    })) as any

    await expect(orpc.ping('input')).resolves.toEqual('pong')

    expect(fetchInterceptor).toHaveBeenCalledOnce()
    expect(fetchInterceptor).toHaveBeenCalledWith(expect.objectContaining({
      context: {},
      path: ['ping'],
      url: 'http://api.example.com/ping',
      init: expect.objectContaining({
        method: 'POST',
        redirect: 'manual',
      }),
    }))

    expect(fetch).toHaveBeenCalledOnce()
    expect(toFetchBody).toHaveBeenCalledWith({ json: 'input' }, {}, toFetchBodyOptions)
  })

  it('supports request without origin', async () => {
    const fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ json: 'pong' }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      })
    })

    const orpc = createORPCClient(new RPCLink({
      fetch,
    })) as any

    await expect(orpc.ping('input')).resolves.toEqual('pong')

    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(
      '/ping',
      expect.objectContaining({
        method: 'POST',
        redirect: 'manual',
      }),
      expect.objectContaining({
        context: {},
      }),
      ['ping'],
    )
  })
})
