import type { FetchHandlerPlugin } from './plugin'
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

  it('support fetch handler plugin', async () => {
    const plugin: FetchHandlerPlugin<any> = {
      name: 'test',
      initFetchHandlerOptions(options) {
        return {
          ...options,
          fetchInterceptors: [
            async () => ({ matched: true, response: new Response('intercepted') }),
          ],
        }
      },
    }

    const handler = new RPCHandler({}, { plugins: [plugin] })

    const { matched, response } = await handler.handle(new Request('https://example.com/test'))

    expect(matched).toBe(true)
    expect(response).toBeInstanceOf(Response)
    expect(response!.status).toBe(200)
    return expect(response!.text()).resolves.toBe('intercepted')
  })

  it('enables csrfGuardHandlerPlugin by default', async () => {
    const handler = new RPCHandler({
      ping: os.handler(() => 'pong'),
    })

    const result = await handler.handle(
      new Request('https://example.com/ping', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cookie': 'session=abc',
          'sec-fetch-mode': 'navigate',
        },
        body: JSON.stringify({ json: null }),
      }),
    )

    expect(result.response?.status).toBe(403)
    expect(await result.response?.text()).toContain('Request blocked by CSRF protection')
  })

  it('disables csrfGuardHandlerPlugin when configured', async () => {
    const handler = new RPCHandler(
      {
        ping: os.handler(() => 'pong'),
      },
      {
        csrfGuardHandlerPlugin: {
          enabled: false,
        },
      },
    )

    const result = await handler.handle(
      new Request('https://example.com/ping', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cookie': 'session=abc',
          'sec-fetch-mode': 'navigate',
        },
        body: JSON.stringify({ json: null }),
      }),
    )

    expect(result.matched).toBe(true)
    expect(result.response).toBeInstanceOf(Response)
    expect(result.response!.status).toBe(200)
    await expect(result.response!.text()).resolves.toContain('pong')
  })
})
