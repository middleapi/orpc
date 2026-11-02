import type { StandardHandlerPlugin } from '../standard'
import { ORPCError } from '@orpc/client'
import { os } from '../../builder'
import { implement } from '../../implementer'
import { RPCHandler } from './rpc-handler'

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

  it('rejects an oversized bigint string with 400 before running middleware', async () => {
    const middleware = vi.fn(({ next }) => next())
    const handler = new RPCHandler({ ping: os.use(middleware).handler(() => 'pong') })

    const { response } = await handler.handle(new Request('https://example.com/ping', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: '9'.repeat(1_000_000), meta: [['bigint']] }),
    }))

    expect(response?.status).toBe(400)
    expect(middleware).not.toHaveBeenCalled()
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

describe('rpcHandler lazy router prefix scan', () => {
  it('scans slash-heavy paths in linear time while a lazy router is still pending', async () => {
    const ping = os.handler(() => 'pong')
    const loader = vi.fn(async () => ({ default: { find: ping } }))
    const handler = new RPCHandler({ ping, planet: os.lazy(loader) })

    // ~16KB request target (accepted by default node:http limits); `%25` forces the normalized second pass
    const url = `http://localhost/rpc/${'/'.repeat(16_000)}%25`

    // warm up so JIT compilation does not count toward the budget
    await handler.handle(new Request(`http://localhost/rpc/${'/'.repeat(100)}%25`, { method: 'POST' }), { prefix: '/rpc' })

    const start = performance.now()
    const result = await handler.handle(new Request(url, { method: 'POST' }), { prefix: '/rpc' })
    const elapsed = performance.now() - start

    expect(result.matched).toBe(false)
    expect(loader).not.toHaveBeenCalled()
    expect(elapsed).toBeLessThan(100) // ~470ms when unbounded, a few ms once bounded

    // lazy routing still works
    const ok = await handler.handle(new Request('http://localhost/rpc/planet/find', { method: 'POST' }), { prefix: '/rpc' })
    expect(ok.matched).toBe(true)
    expect(loader).toHaveBeenCalledTimes(1)
  })
})

describe('rpcHandler with a normal router implemented as the contract', () => {
  const real = {
    ping: os.handler(() => 'REAL'),
    nested: {
      pong: os.handler(() => 'REAL'),
    },
  }

  function post(handler: RPCHandler<any>, path: string) {
    return handler.handle(new Request(`https://example.com${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: null }),
    }))
  }

  it('serves the implementation instead of the contract', async () => {
    const impl = implement(real)
    const mock = impl.router({
      ping: impl.ping.handler(() => 'MOCK'),
      nested: {
        pong: impl.nested.pong.handler(() => 'MOCK'),
      },
    })

    const handler = new RPCHandler(mock)

    const ping = await post(handler, '/ping')
    expect(ping.matched).toBe(true)
    await expect(ping.response!.json()).resolves.toEqual({ json: 'MOCK' })

    const pong = await post(handler, '/nested/pong')
    expect(pong.matched).toBe(true)
    await expect(pong.response!.json()).resolves.toEqual({ json: 'MOCK' })
  })

  it('runs middlewares applied through the implementer', async () => {
    const requireAuth = vi.fn(() => {
      throw new ORPCError('UNAUTHORIZED')
    })

    const impl = implement(real)
    const mock = impl.use(requireAuth).router({
      ping: impl.ping.handler(() => 'MOCK'),
      nested: impl.nested.router({
        pong: impl.nested.pong.handler(() => 'MOCK'),
      }),
    })

    const handler = new RPCHandler(mock)

    const ping = await post(handler, '/ping')
    expect(ping.response!.status).toBe(401)

    const pong = await post(handler, '/nested/pong')
    expect(pong.response!.status).toBe(401)

    expect(requireAuth).toHaveBeenCalledTimes(2)
  })
})
