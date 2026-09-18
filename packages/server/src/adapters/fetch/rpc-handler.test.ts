import type { StandardHandlerPlugin } from '../standard'
import { os } from '../../builder'
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
