import type { StandardHandlerPlugin } from '@orpc/server/standard'
import { createORPCClient, ORPCError } from '@orpc/client'
import { implement, os } from '@orpc/server'
import { openapi } from '../../meta'
import { OpenAPIHandler } from './openapi-handler'
import { OpenAPILink } from './openapi-link'

describe('openapiHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts context and prefix options in handle method', async () => {
    const contextHandler = new OpenAPIHandler({
      ping: os
        .$context<{ userId: string }>()
        .meta(openapi({ method: 'POST', path: '/ping/pong' }))
        .handler(({ context }) => context.userId),
    })

    const { matched, response } = await contextHandler.handle(
      new Request('https://example.com/api/v1/ping/pong', {
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

  it('routes an OpenAPILink call with a raw char to its static route, not a dynamic sibling', async () => {
    const router = {
      beta: os.meta(openapi({ method: 'GET', path: '/v1^beta/items' })).handler(() => 'beta'),
      version: os.meta(openapi({ method: 'GET', path: '/{version}/items' })).handler(() => 'version'),
    }

    const handler = new OpenAPIHandler(router)

    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      const { matched, response } = await handler.handle(new Request(url, init), { prefix: '/api' })

      if (!matched || !response) {
        throw new Error('No procedure match')
      }

      return response
    })

    const client = createORPCClient<any>(new OpenAPILink(router, {
      fetch,
      origin: 'http://localhost:3000',
      url: '/api',
    }))

    await expect(client.beta()).resolves.toBe('beta')
    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1^beta/items', expect.anything(), expect.anything(), ['beta'])
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

    const handler = new OpenAPIHandler({}, { plugins: [plugin] })

    const { matched, response } = await handler.handle(new Request('https://example.com/test'))

    expect(matched).toBe(true)
    expect(response).toBeInstanceOf(Response)
    expect(response!.status).toBe(200)
    return expect(response!.text()).resolves.toBe('"intercepted"')
  })

  it('serves the implementation and its middlewares when a normal router is implemented as the contract', async () => {
    const real = {
      ping: os.meta(openapi({ method: 'GET', path: '/ping' })).handler(() => 'REAL'),
      nested: { pong: os.handler(() => 'REAL') },
    }

    const impl = implement(real)
    const requireAuth = vi.fn(() => {
      throw new ORPCError('UNAUTHORIZED')
    })

    const mock = new OpenAPIHandler(impl.router({
      ping: impl.ping.handler(() => 'MOCK'),
      nested: { pong: impl.nested.pong.handler(() => 'MOCK') },
    }))

    const secured = new OpenAPIHandler(impl.use(requireAuth).router({
      ping: impl.ping.handler(() => 'MOCK'),
      nested: { pong: impl.nested.pong.handler(() => 'MOCK') },
    }))

    for (const [method, path] of [['GET', '/ping'], ['POST', '/nested/pong']] as const) {
      const request = () => new Request(`https://example.com${path}`, { method })

      const { response } = await mock.handle(request())
      await expect(response!.json()).resolves.toBe('MOCK')

      const { response: securedResponse } = await secured.handle(request())
      expect(securedResponse!.status).toBe(401)
    }

    expect(requireAuth).toHaveBeenCalledTimes(2)
  })
})
