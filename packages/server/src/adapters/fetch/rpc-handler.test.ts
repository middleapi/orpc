import type { StandardHandlerPlugin } from '../standard'
import { createORPCClient, MalformedResponseError, ORPCError } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { onError } from '@orpc/shared'
import { os } from '../../builder'
import { RPCHandler } from './rpc-handler'

const LEAKED = ['internal_session', 'node-7', 'pg-primary', 'SELECT']
const UPSTREAM_HEADERS = { 'set-cookie': 'internal_session=abc123; HttpOnly', 'x-internal-trace': 'node-7' }

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...UPSTREAM_HEADERS, 'content-type': 'application/json' },
  })
}

function htmlResponse(status: number, html: string): Response {
  return new Response(html, {
    status,
    headers: { ...UPSTREAM_HEADERS, 'content-type': 'text/html', 'content-length': String(new TextEncoder().encode(html).length) },
  })
}

describe('rpcHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts context and prefix options in handle method', async () => {
    const contextHandler = new RPCHandler({
      ping: os
        .$context<{ userId: string }>()
        .handler(({ context }) => context.userId),
    })

    const { matched, response } = await contextHandler.handle(
      new Request('https://example.com/api/v1/ping', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ json: null }),
      }),
      {
        context: { userId: 'u_123' },
        prefix: '/api/v1',
      },
    )

    expect(matched).toBe(true)
    expect(response!.status).toBe(200)
    await expect(response!.text()).resolves.toContain('u_123')

    const misMatchPrefixResult = await contextHandler.handle(
      new Request('https://example.com/invalid/ping', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ json: null }),
      }),
      {
        context: { userId: 'u_123' },
        prefix: '/api/v1',
      },
    )

    expect(misMatchPrefixResult.matched).toBe(false)
    expect(misMatchPrefixResult.response).toBeUndefined()
  })

  it('supports standard handler plugins', async () => {
    const plugin: StandardHandlerPlugin<any> = {
      name: 'test',
      init(options) {
        return {
          ...options,
          routingInterceptors: [
            async () => ({ matched: true, response: { status: 200, headers: {}, body: 'intercepted' } }),
          ],
        }
      },
    }

    const handler = new RPCHandler({}, { plugins: [plugin] })

    const { matched, response } = await handler.handle(new Request('https://example.com/test'))

    expect(matched).toBe(true)
    expect(response).toBeInstanceOf(Response)
    expect(response!.status).toBe(200)
    return expect(response!.text()).resolves.toBe('"intercepted"')
  })

  it('treats GET requests as unmatched by default', async () => {
    const handler = new RPCHandler({
      ping: os.handler(() => 'pong'),
    })

    const result = await handler.handle(
      new Request(`https://example.com/ping?data=${encodeURIComponent(JSON.stringify({ json: null }))}`),
    )

    expect(result.matched).toBe(false)
    expect(result.response).toBeUndefined()
  })

  it('treats unsupported methods like OPTIONS as unmatched', async () => {
    const handler = new RPCHandler(
      {
        ping: os.handler(() => 'pong'),
      },
      {
        allowMethods: ['GET'],
      },
    )

    const result = await handler.handle(
      new Request('https://example.com/ping', { method: 'OPTIONS' }),
    )

    expect(result.matched).toBe(false)
    expect(result.response).toBeUndefined()
  })

  it('allows GET requests when allowMethods includes GET', async () => {
    const handler = new RPCHandler(
      {
        ping: os.handler(() => 'pong'),
      },
      {
        allowMethods: ['GET'],
      },
    )

    const result = await handler.handle(
      new Request(`https://example.com/ping?data=${encodeURIComponent(JSON.stringify({ json: null }))}`),
    )

    expect(result.matched).toBe(true)
    expect(result.response!.status).toBe(200)
    await expect(result.response!.text()).resolves.toContain('pong')
  })

  it('supports deciding allowMethods per procedure', async () => {
    const allowMethods = vi.fn((method: string, _procedure: unknown, path: string[]) => method === 'GET' && path[0] === 'public')

    const handler = new RPCHandler(
      {
        public: os.handler(() => 'public'),
        private: os.handler(() => 'private'),
      },
      {
        allowMethods,
      },
    )

    const allowed = await handler.handle(
      new Request(`https://example.com/public?data=${encodeURIComponent(JSON.stringify({ json: null }))}`),
    )

    expect(allowed.matched).toBe(true)
    expect(allowed.response!.status).toBe(200)
    await expect(allowed.response!.text()).resolves.toContain('public')

    const blocked = await handler.handle(
      new Request(`https://example.com/private?data=${encodeURIComponent(JSON.stringify({ json: null }))}`),
    )

    expect(blocked.matched).toBe(false)
    expect(allowMethods).toHaveBeenCalledTimes(2)
  })
})

describe('rpcHandler - errors from an upstream oRPC link', () => {
  async function callThrough(upstreamResponse: () => Response, interceptor?: (error: unknown) => void) {
    const upstream = createORPCClient<any>(new RPCLink({ origin: 'http://upstream.internal', url: '/rpc', fetch: async () => upstreamResponse() }))
    const handler = new RPCHandler({ profile: os.handler(() => upstream.user.find({ id: '1' })) }, {
      interceptors: interceptor ? [onError(interceptor)] : [],
    })
    const { response } = await handler.handle(new Request('https://example.com/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: {} }),
    }))
    return { status: response!.status, text: await response!.text() }
  }

  it.each([
    ['a non-oRPC JSON error response', () => jsonResponse(503, { message: 'db timeout on pg-primary-10.0.3.7', query: 'SELECT * FROM users' })],
    ['a 2xx response that fails deserialization', () => jsonResponse(200, { json: 1, meta: 'bad' })],
    ['a non-JSON error page', () => htmlResponse(502, '<html><body>pg-primary: SELECT failed</body></html>')],
  ])('does not expose %s to the caller', async (_, upstreamResponse) => {
    const { status, text } = await callThrough(upstreamResponse)
    expect(status).toBe(500)
    for (const value of LEAKED) {
      expect(text).not.toContain(value)
    }
    expect(JSON.parse(text)).toEqual({ json: { defined: false, code: 'INTERNAL_SERVER_ERROR', message: 'Internal Server Error' } })
  })

  it('still relays a well-formed upstream oRPC error', async () => {
    const { status, text } = await callThrough(() => jsonResponse(404, { json: { defined: true, code: 'NOT_FOUND', message: 'User not found' } }))
    expect(status).toBe(404)
    expect(JSON.parse(text)).toEqual({ json: { defined: false, code: 'NOT_FOUND', message: 'User not found' } })
  })

  it('passes the original malformed-response error to interceptors', async () => {
    const interceptor = vi.fn()
    await callThrough(() => jsonResponse(503, { message: 'db timeout on pg-primary-10.0.3.7' }), interceptor)
    expect(interceptor).toHaveBeenCalledOnce()
    const error = interceptor.mock.calls[0]![0]
    expect(error).toBeInstanceOf(ORPCError)
    expect(error.code).toBe('MALFORMED_ORPC_RESPONSE')
    expect(error.message).toBe('db timeout on pg-primary-10.0.3.7')
    expect(error.cause).toBeInstanceOf(MalformedResponseError)
    expect(error.cause.response).toEqual(expect.objectContaining({ status: 503 }))
  })
})
