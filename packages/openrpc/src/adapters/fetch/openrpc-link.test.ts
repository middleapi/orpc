import type { NestedClient } from '@orpc/client'
import { createORPCClient, isDefinedError, MalformedResponseError, ORPCError, ResponseError, safe } from '@orpc/client'
import { RetryLinkPlugin } from '@orpc/client/plugins'
import { OpenRPCLink } from './openrpc-link'

/**
 * A fake JSON-RPC server: answers every request with `respond(request)`, echoing the request id.
 */
function createFetch(respond: (request: any) => { status?: number, body?: unknown, headers?: Record<string, string> } | undefined) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(init.body as string)
    const reply = respond(request)

    if (reply?.body === undefined) {
      return new Response(null, { status: reply?.status ?? 204, headers: reply?.headers })
    }

    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json', ...reply.headers },
    })
  })
}

function result(request: any, value: unknown) {
  return { body: { jsonrpc: '2.0', id: request.id, result: value } }
}

function error(request: any, error: unknown, status?: number) {
  return { status, body: { jsonrpc: '2.0', id: request.id, error } }
}

describe('openRPCLink', () => {
  it('sends a JSON-RPC request and resolves the result', async () => {
    const fetch = createFetch(request => result(request, { id: request.params.id, name: 'earth' }))
    const client = createORPCClient(new OpenRPCLink({
      fetch,
      origin: 'http://localhost:3000',
      url: '/rpc',
      headers: { 'x-api-key': 'key' },
    })) as any

    await expect(client.planet.find({ id: 1, at: new Date('2024-01-02T03:04:05.000Z') })).resolves.toEqual({ id: 1, name: 'earth' })

    expect(fetch).toHaveBeenCalledOnce()
    const [url, init, options, path] = fetch.mock.calls[0]! as any[]
    expect(url).toBe('http://localhost:3000/rpc')
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('manual')
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
    expect(new Headers(init.headers).get('x-api-key')).toBe('key')
    expect(JSON.parse(init.body)).toEqual({
      jsonrpc: '2.0',
      method: 'planet.find',
      params: { id: 1, at: '2024-01-02T03:04:05.000Z' },
      id: 1,
    })
    expect(options).toEqual(expect.objectContaining({ context: {} }))
    expect(path).toEqual(['planet', 'find'])
  })

  it('sends non-object inputs by-position and omits undefined inputs', async () => {
    const fetch = createFetch(request => result(request, request.params ?? null))
    const client = createORPCClient(new OpenRPCLink({ fetch })) as any

    await expect(client.echo('earth')).resolves.toEqual(['earth'])
    await expect(client.echo()).resolves.toBeNull()

    expect(fetch.mock.calls[0]![0]).toBe('/')
    expect(JSON.parse(fetch.mock.calls[1]![1].body as string)).toEqual({ jsonrpc: '2.0', method: 'echo', id: 2 })
  })

  it('uses globalThis.fetch by default', async () => {
    const fetch = createFetch(request => result(request, 'pong'))
    vi.stubGlobal('fetch', fetch)

    try {
      const client = createORPCClient(new OpenRPCLink()) as any

      await expect(client.ping()).resolves.toBe('pong')
      expect(fetch).toHaveBeenCalledOnce()
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('resolves context-dependent options', async () => {
    const fetch = createFetch(request => result(request, 'ok'))
    const link = new OpenRPCLink<{ token: string }>({
      fetch,
      url: ({ context }) => context.token === 'admin' ? '/admin/rpc' : '/rpc',
      headers: async ({ context }) => ({ authorization: `Bearer ${context.token}` }),
    })
    const client = createORPCClient<NestedClient<{ token: string }>>(link) as any

    await client.ping(undefined, { context: { token: 'admin' } })

    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('/admin/rpc')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer admin')
  })

  it('forwards the abort signal', async () => {
    const controller = new AbortController()
    const fetch = createFetch(request => result(request, 'ok'))
    const client = createORPCClient(new OpenRPCLink({ fetch })) as any

    await client.ping(undefined, { signal: controller.signal })

    expect(fetch.mock.calls[0]![1].signal).toBe(controller.signal)
  })

  it('spreads params for foreign APIs with encodeParams', async () => {
    const fetch = createFetch(request => result(request, '0x1'))
    const client = createORPCClient(new OpenRPCLink({
      fetch,
      encodeParams: input => input as unknown[],
    })) as any

    await expect(client.eth_getBalance(['0xabc', 'latest'])).resolves.toBe('0x1')

    expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual({
      jsonrpc: '2.0',
      method: 'eth_getBalance',
      params: ['0xabc', 'latest'],
      id: 1,
    })
  })

  it('throws defined errors that isDefinedError recognizes', async () => {
    const fetch = createFetch(request => error(request, {
      code: -32004,
      message: 'Planet not found',
      data: { code: 'NOT_FOUND', defined: true, data: { id: 1 } },
    }))
    const client = createORPCClient(new OpenRPCLink({ fetch })) as any

    const [err, data, definedError] = await safe(client.planet.find({ id: 1 }))

    expect(data).toBeUndefined()
    expect(definedError).toBe(err)
    expect(isDefinedError(err)).toBe(true)
    expect(err).toBeInstanceOf(ORPCError)
    expect((err as any).code).toBe('NOT_FOUND')
    expect((err as any).data).toEqual({ id: 1 })
    expect((err as any).cause).toBeInstanceOf(ResponseError)
    expect((err as any).cause.response.status).toBe(404)
  })

  it('decodes errors of foreign JSON-RPC servers', async () => {
    const fetch = createFetch(request => error(request, { code: -32601, message: 'Method not found' }))
    const client = createORPCClient(new OpenRPCLink({ fetch })) as any

    const err = await client.unknown().catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ORPCError)
    expect(err.code).toBe('NOT_FOUND')
    expect(err.defined).toBe(false)
    expect(err.message).toBe('Method not found')
  })

  it('throws MalformedResponseError for non-JSON-RPC responses', async () => {
    const fetch = vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }))
    const client = createORPCClient(new OpenRPCLink({ fetch })) as any

    const err = await client.ping().catch((e: unknown) => e)

    expect(err).toBeInstanceOf(MalformedResponseError)
    expect(err.message).toBe('Bad Gateway')
    expect(err.response.status).toBe(502)
  })

  it('throws MalformedResponseError for a mismatched response id', async () => {
    const fetch = createFetch(() => ({ body: { jsonrpc: '2.0', id: 999, result: 'pong' } }))
    const client = createORPCClient(new OpenRPCLink({ fetch })) as any

    const err = await client.ping().catch((e: unknown) => e)

    expect(err).toBeInstanceOf(MalformedResponseError)
    expect(err.message).toBe('JSON-RPC response id does not match the request id.')
    expect(err.response.body).toEqual({ jsonrpc: '2.0', id: 999, result: 'pong' })
  })

  it('throws before sending unsupported inputs', async () => {
    const fetch = createFetch(request => result(request, 'ok'))
    const client = createORPCClient(new OpenRPCLink({ fetch })) as any

    await expect(client.upload(new Blob(['x']))).rejects.toThrow(
      '[OpenRPCLink] JSON-RPC cannot send Blob, File, FormData, URLSearchParams, or streams in call to procedure (upload).',
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  describe('notifications', () => {
    it('sends a notification and resolves undefined once accepted', async () => {
      const fetch = createFetch(() => undefined)
      const client = createORPCClient(new OpenRPCLink({ fetch, notification: true })) as any

      await expect(client.log({ level: 'info' })).resolves.toBeUndefined()

      expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual({
        jsonrpc: '2.0',
        method: 'log',
        params: { level: 'info' },
      })
    })

    it('chooses notifications per call', async () => {
      const fetch = createFetch(request => request.id === undefined ? undefined : result(request, 'pong'))
      const client = createORPCClient(new OpenRPCLink<{ notify?: boolean }>({
        fetch,
        notification: ({ context }) => context.notify === true,
      })) as any

      await expect(client.ping(undefined, { context: { notify: true } })).resolves.toBeUndefined()
      await expect(client.ping()).resolves.toBe('pong')

      expect(JSON.parse(fetch.mock.calls[1]![1].body as string).id).toBe(1)
    })

    it('rejects with the error the server reports', async () => {
      const fetch = createFetch(() => ({
        status: 415,
        body: {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32015, message: 'Unsupported media type', data: { code: 'UNSUPPORTED_MEDIA_TYPE', defined: false } },
        },
      }))
      const client = createORPCClient(new OpenRPCLink({ fetch, notification: true })) as any

      const err = await client.log().catch((e: unknown) => e)

      expect(err).toBeInstanceOf(ORPCError)
      expect(err.code).toBe('UNSUPPORTED_MEDIA_TYPE')
      expect(err.cause.response.status).toBe(415)
    })
  })

  describe('retries', () => {
    it('retries server errors delivered with 200, with a new id per attempt', async () => {
      let attempts = 0
      const fetch = createFetch((request) => {
        attempts++

        return attempts === 1
          ? error(request, { code: -32603, message: 'Internal server error', data: { code: 'INTERNAL_SERVER_ERROR', defined: false } })
          : result(request, 'pong')
      })
      const client = createORPCClient(new OpenRPCLink({
        fetch,
        plugins: [new RetryLinkPlugin({ default: { retry: 2, retryDelay: 0 } })],
      })) as any

      await expect(client.ping()).resolves.toBe('pong')

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(fetch.mock.calls.map(([, init]) => JSON.parse(init.body as string).id)).toEqual([1, 2])
    })

    it('does not retry client errors delivered with 200', async () => {
      const fetch = createFetch(request => error(request, {
        code: -32602,
        message: 'Input validation failed',
        data: { code: 'BAD_REQUEST', defined: false },
      }))
      const client = createORPCClient(new OpenRPCLink({
        fetch,
        plugins: [new RetryLinkPlugin({ default: { retry: 2, retryDelay: 0 } })],
      })) as any

      await expect(client.ping()).rejects.toThrow('Input validation failed')

      expect(fetch).toHaveBeenCalledOnce()
    })
  })
})
