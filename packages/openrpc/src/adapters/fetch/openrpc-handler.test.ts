import type { StandardHandlerPlugin } from '@orpc/server/standard'
import { ORPCError, os } from '@orpc/server'
import { CORSHandlerPlugin } from '@orpc/server/plugins'
import { z } from 'zod'
import { OpenRPCHandler } from './openrpc-handler'

function createRequest(body: unknown, init: RequestInit & { url?: string } = {}): Request {
  return new Request(init.url ?? 'https://example.com/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  })
}

describe('openRPCHandler', () => {
  const router = {
    ping: os
      .$context<{ userId: string }>()
      .handler(({ context }) => `pong ${context.userId}`),
    planet: {
      find: os.input(z.object({ id: z.number() })).handler(({ input }) => ({ id: input.id, name: 'Earth' })),
    },
    missing: os.handler(() => {
      throw new ORPCError('NOT_FOUND')
    }),
  }

  const handler = new OpenRPCHandler(router)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('answers a single call', async () => {
    const { matched, response } = await handler.handle(
      createRequest({ jsonrpc: '2.0', method: 'ping', id: 1 }),
      { context: { userId: 'u_123' }, prefix: '/rpc' },
    )

    expect(matched).toBe(true)
    expect(response!.status).toBe(200)
    expect(response!.headers.get('content-type')).toBe('application/json')
    await expect(response!.json()).resolves.toEqual({ jsonrpc: '2.0', id: 1, result: 'pong u_123' })
  })

  it('answers a batch', async () => {
    const { response } = await handler.handle(
      createRequest([
        { jsonrpc: '2.0', method: 'planet.find', params: { id: 1 }, id: 1 },
        { jsonrpc: '2.0', method: 'ping' },
        { jsonrpc: '2.0', method: 'missing', id: 2 },
      ]),
      { context: { userId: 'u_123' }, prefix: '/rpc' },
    )

    expect(response!.status).toBe(200)
    await expect(response!.json()).resolves.toEqual([
      { jsonrpc: '2.0', id: 1, result: { id: 1, name: 'Earth' } },
      { jsonrpc: '2.0', id: 2, error: { code: -32004, message: 'Not Found', data: { code: 'NOT_FOUND', defined: false } } },
    ])
  })

  it('answers notifications with 204 and no body', async () => {
    const { response } = await handler.handle(
      createRequest({ jsonrpc: '2.0', method: 'ping' }),
      { context: { userId: 'u_123' }, prefix: '/rpc' },
    )

    expect(response!.status).toBe(204)
    expect(response!.headers.get('content-type')).toBeNull()
    await expect(response!.text()).resolves.toBe('')
  })

  it('rejects other content types with 415', async () => {
    const { response } = await handler.handle(
      createRequest({ jsonrpc: '2.0', method: 'ping', id: 1 }, { headers: { 'content-type': 'text/plain' } }),
      { context: { userId: 'u_123' }, prefix: '/rpc' },
    )

    expect(response!.status).toBe(415)
    await expect(response!.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32015, message: 'JSON-RPC requests must use Content-Type: application/json', data: { code: 'UNSUPPORTED_MEDIA_TYPE', defined: false } },
    })
  })

  it('answers invalid JSON with "Parse error"', async () => {
    const { response } = await handler.handle(
      createRequest('{"jsonrpc": "2.0", "method"'),
      { context: { userId: 'u_123' }, prefix: '/rpc' },
    )

    expect(response!.status).toBe(200)
    await expect(response!.json()).resolves.toEqual({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
  })

  it('passes requests outside the endpoint through', async () => {
    const outside = await handler.handle(
      createRequest({ jsonrpc: '2.0', method: 'ping', id: 1 }, { url: 'https://example.com/rpc/ping' }),
      { context: { userId: 'u_123' }, prefix: '/rpc' },
    )

    expect(outside).toEqual({ matched: false })

    const otherPrefix = await handler.handle(
      createRequest({ jsonrpc: '2.0', method: 'ping', id: 1 }, { url: 'https://example.com/api' }),
      { context: { userId: 'u_123' }, prefix: '/rpc' },
    )

    expect(otherPrefix).toEqual({ matched: false })

    const get = await handler.handle(
      new Request('https://example.com/rpc'),
      { context: { userId: 'u_123' }, prefix: '/rpc' },
    )

    expect(get).toEqual({ matched: false })
  })

  it('answers a result JSON cannot carry with "Internal error", keeping the other calls of a batch', async () => {
    const handler = new OpenRPCHandler({
      ping: os.handler(() => 'pong'),
      fn: os.handler(() => () => 1),
      symbol: os.handler(() => Symbol('result')),
    })

    const { response } = await handler.handle(
      createRequest([
        { jsonrpc: '2.0', method: 'ping', id: 1 },
        { jsonrpc: '2.0', method: 'fn', id: 2 },
        { jsonrpc: '2.0', method: 'symbol', id: 3 },
      ]),
      { prefix: '/rpc' },
    )

    const internalError = { code: -32603, message: 'Internal Server Error', data: { code: 'INTERNAL_SERVER_ERROR', defined: false } }

    await expect(response!.json()).resolves.toEqual([
      { jsonrpc: '2.0', id: 1, result: 'pong' },
      { jsonrpc: '2.0', id: 2, error: internalError },
      { jsonrpc: '2.0', id: 3, error: internalError },
    ])

    const single = await handler.handle(createRequest({ jsonrpc: '2.0', method: 'fn', id: 1 }), { prefix: '/rpc' })

    await expect(single.response!.json()).resolves.toEqual({ jsonrpc: '2.0', id: 1, error: internalError })
  })

  it('resolves empty params for by-name inputs with async validation', async () => {
    const handler = new OpenRPCHandler({
      list: os.input(z.object({ cursor: z.string().optional() }).refine(async () => true)).handler(({ input }) => input),
      empty: os.input(z.object({}).refine(async () => true)).handler(({ input }) => input),
    })

    const { response } = await handler.handle(
      createRequest([
        { jsonrpc: '2.0', method: 'list', id: 1 },
        { jsonrpc: '2.0', method: 'list', params: [], id: 2 },
        { jsonrpc: '2.0', method: 'list', params: null, id: 3 },
        { jsonrpc: '2.0', method: 'list', params: {}, id: 4 },
        { jsonrpc: '2.0', method: 'empty', id: 5 },
        { jsonrpc: '2.0', method: 'empty', params: [], id: 6 },
      ]),
      { prefix: '/rpc' },
    )

    await expect(response!.json()).resolves.toEqual([1, 2, 3, 4, 5, 6].map(id => ({ jsonrpc: '2.0', id, result: {} })))
  })

  it('passes the codec and envelope options through', async () => {
    const handler = new OpenRPCHandler(router, {
      filter: (_, path) => path[0] !== 'missing',
      errorCodeMap: { NOT_FOUND: 404 },
      errorResponseStatus: 'mapped',
      maxBatchSize: 1,
    })

    const filtered = await handler.handle(createRequest({ jsonrpc: '2.0', method: 'missing', id: 1 }), { context: { userId: 'u' }, prefix: '/rpc' })
    expect(filtered.response!.status).toBe(404)
    await expect(filtered.response!.json()).resolves.toEqual({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } })

    const tooLarge = await handler.handle(createRequest([
      { jsonrpc: '2.0', method: 'ping', id: 1 },
      { jsonrpc: '2.0', method: 'ping', id: 2 },
    ]), { context: { userId: 'u' }, prefix: '/rpc' })
    expect(tooLarge.response!.status).toBe(413)
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

    const handler = new OpenRPCHandler({}, { plugins: [plugin] })

    const { matched, response } = await handler.handle(new Request('https://example.com/test'))

    expect(matched).toBe(true)
    expect(response!.status).toBe(200)
    await expect(response!.text()).resolves.toBe('"intercepted"')
  })

  it('keeps user plugins outside the envelope when they ask for it', async () => {
    const handler = new OpenRPCHandler(router, {
      plugins: [new CORSHandlerPlugin({ origin: 'https://app.example.com' })],
    })

    const { response } = await handler.handle(
      createRequest([{ jsonrpc: '2.0', method: 'ping', id: 1 }], { headers: { 'content-type': 'application/json', 'origin': 'https://app.example.com' } }),
      { context: { userId: 'u' }, prefix: '/rpc' },
    )

    expect(response!.headers.get('access-control-allow-origin')).toBe('https://app.example.com')
    await expect(response!.json()).resolves.toEqual([{ jsonrpc: '2.0', id: 1, result: 'pong u' }])
  })
})
