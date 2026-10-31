import type { RateLimitHandlerPluginContext } from '@orpc/ratelimit'
import type { RequestHeadersHandlerPluginContext, ResponseHeadersHandlerPluginContext } from '@orpc/server/plugins'
import { EvlogHandlerPlugin } from '@orpc/evlog'
import { OpenRPCHandler } from '@orpc/openrpc/fetch'
import { PinoHandlerPlugin } from '@orpc/pino'
import { RATELIMIT_HANDLER_PLUGIN_CONTEXT_SYMBOL, RateLimitHandlerPlugin } from '@orpc/ratelimit'
import { ORPCError, os } from '@orpc/server'
import {
  BatchHandlerPlugin,
  CORSHandlerPlugin,
  RequestCompressionHandlerPlugin,
  RequestHeadersHandlerPlugin,
  RequestLimitHandlerPlugin,
  ResponseCompressionHandlerPlugin,
  ResponseHeadersHandlerPlugin,
  RethrowHandlerPlugin,
  SignalSyncHandlerPlugin,
  TimeoutHandlerPlugin,
} from '@orpc/server/plugins'
import pino from 'pino'
import { z } from 'zod'

/**
 * Which level each handler plugin hooks into on `OpenRPCHandler`: routing interceptors run once per HTTP request,
 * interceptors and client interceptors once per JSON-RPC call.
 */

interface TestContext extends RequestHeadersHandlerPluginContext, ResponseHeadersHandlerPluginContext, RateLimitHandlerPluginContext {}

const base = os.$context<TestContext>()

const router = {
  login: base.input(z.object({ user: z.string() })).handler(({ input, context }) => {
    context.resHeaders?.append('set-cookie', `session=${input.user}; HttpOnly`)
    return input.user
  }),
  limited: base.input(z.object({ remaining: z.number() })).handler(({ input, context, path, procedure }) => {
    const success = input.remaining > 0
    context[RATELIMIT_HANDLER_PLUGIN_CONTEXT_SYMBOL]?.checks.push({ path, procedure, result: { success, limit: 10, remaining: input.remaining, reset: Date.now() + 60_000 } })

    if (!success) {
      throw new ORPCError('TOO_MANY_REQUESTS')
    }

    return input.remaining
  }),
}

function createHandler() {
  const logs: Record<string, any>[] = []
  const events: Record<string, any>[] = []
  const logger = pino({ level: 'info' }, { write: line => logs.push(JSON.parse(line)) })

  const handler = new OpenRPCHandler<TestContext>(router, {
    plugins: [
      new BatchHandlerPlugin(),
      new CORSHandlerPlugin(),
      new EvlogHandlerPlugin({ drain: ({ event }) => void events.push(event) }),
      new PinoHandlerPlugin({ logger, logLifecycle: true }),
      new RateLimitHandlerPlugin(),
      new RequestCompressionHandlerPlugin(),
      new RequestHeadersHandlerPlugin(),
      new RequestLimitHandlerPlugin({ maxBodySize: 10 * 1024 }),
      new ResponseCompressionHandlerPlugin({ threshold: 0 }),
      new ResponseHeadersHandlerPlugin(),
      new RethrowHandlerPlugin({ filter: () => false }),
      new SignalSyncHandlerPlugin(),
      new TimeoutHandlerPlugin({ timeout: 5000 }),
    ],
  })

  return { handler, logs, events }
}

async function post(handler: OpenRPCHandler<TestContext>, body: unknown, headers: Record<string, string> = {}) {
  const { response } = await handler.handle(new Request('http://localhost/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }), { prefix: '/rpc', context: {} })

  return response!
}

describe('handler plugins on OpenRPCHandler', () => {
  it('apply CORS, compression and response headers to the HTTP response of a batch', async () => {
    const { handler } = createHandler()

    const response = await post(handler, [
      { jsonrpc: '2.0', method: 'login', params: { user: 'alice' }, id: 1 },
      { jsonrpc: '2.0', method: 'login', params: { user: 'bob' }, id: 2 },
    ], { 'origin': 'https://example.com', 'accept-encoding': 'gzip' })

    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('content-encoding')).toBe('gzip')
    expect(response.headers.getSetCookie().sort()).toEqual(['session=alice; HttpOnly', 'session=bob; HttpOnly'])
    await expect(new Response(response.body!.pipeThrough(new DecompressionStream('gzip'))).json()).resolves.toEqual([
      { jsonrpc: '2.0', id: 1, result: 'alice' },
      { jsonrpc: '2.0', id: 2, result: 'bob' },
    ])
  })

  it('sets the rate limit headers of the most constrained call, without retry-after since JSON-RPC errors use 200', async () => {
    const { handler } = createHandler()

    const response = await post(handler, [
      { jsonrpc: '2.0', method: 'limited', params: { remaining: 5 }, id: 1 },
      { jsonrpc: '2.0', method: 'limited', params: { remaining: 0 }, id: 2 },
    ])

    expect(response.status).toBe(200)
    expect(response.headers.get('ratelimit-remaining')).toBe('0')
    expect(response.headers.get('retry-after')).toBeNull()
    await expect(response.json()).resolves.toMatchObject([{ result: 5 }, { error: { code: -32029 } }])
  })

  it('logs one request (and one wide event) per HTTP request, so the calls of a batch share one rpc binding', async () => {
    const { handler, logs, events } = createHandler()

    await post(handler, [
      { jsonrpc: '2.0', method: 'login', params: { user: 'alice' }, id: 1 },
      { jsonrpc: '2.0', method: 'limited', params: { remaining: 1 }, id: 2 },
    ])

    const handled = logs.filter(log => log.msg === 'request handled')

    expect(handled).toHaveLength(1)
    expect(handled[0]).toMatchObject({ req: { url: '/rpc', method: 'POST' }, res: { status: 200 } })
    // the per-call interceptors of pino and evlog set `rpc` on the shared request logger, so the last call wins
    expect(['login', 'limited']).toContain(handled[0]!.rpc.method)

    await vi.waitFor(() => expect(events).toHaveLength(1))
    expect(events[0]).toMatchObject({ method: 'POST', path: '/rpc', status: 200 })
    expect(['login', 'limited']).toContain(events[0]!.rpc.method)
  })

  it('keeps the order core gives plugins around tracing, so CORS answers preflights before logging plugins see them', async () => {
    const logs: Record<string, any>[] = []
    const handler = new OpenRPCHandler<TestContext>(router, {
      plugins: [
        new CORSHandlerPlugin(),
        new PinoHandlerPlugin({ logger: pino({ level: 'info' }, { write: line => logs.push(JSON.parse(line)) }), logLifecycle: true }),
      ],
    })

    const { response } = await handler.handle(new Request('http://localhost/rpc', {
      method: 'OPTIONS',
      headers: { 'origin': 'https://example.com', 'access-control-request-method': 'POST' },
    }), { prefix: '/rpc', context: {} })

    expect(response?.status).toBe(204)
    expect(logs).toEqual([])
  })
})
