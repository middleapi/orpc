import type { StandardHandlerPlugin } from '@orpc/server/standard'
import { createORPCClient, ORPCError } from '@orpc/client'
import { os } from '@orpc/server'
import { CsrfProtectionHandlerPlugin, GetMethodCsrfProtectionHandlerPlugin, MethodOverrideHandlerPlugin } from '@orpc/server/plugins'
import * as z from 'zod'
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

  describe('cross-site form CSRF', () => {
    function createRouter(calls: unknown[], method: 'POST' | 'DELETE' = 'POST') {
      return {
        transfer: os.$context<{ headers: Headers }>()
          .meta(openapi({ method, path: '/transfer' }))
          .use(({ context, next }) => {
            if (!context.headers.get('cookie')?.includes('session=victim'))
              throw new ORPCError('UNAUTHORIZED')
            return next({ context: { user: 'victim' } })
          })
          .input(z.object({ to: z.string(), amount: z.coerce.number() }))
          .handler(({ input, context }) => {
            calls.push({ input, user: context.user })
            return { ok: true }
          }),
      }
    }

    // What a browser sends for a cross-site <form method=POST action=https://app.example.com/api/transfer>
    function crossSiteUrlencodedForm(search = '') {
      return new Request(`https://app.example.com/api/transfer${search}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'cookie': 'session=victim',
          'origin': 'https://evil.example',
          'sec-fetch-site': 'cross-site',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-dest': 'document',
        },
        body: 'to=attacker&amount=1000',
      })
    }

    async function run(handler: OpenAPIHandler<any>, request: Request) {
      return handler.handle(request, { prefix: '/api', context: { headers: request.headers } })
    }

    it('runs a POST procedure from a cross-site urlencoded form despite the GET CSRF plugin', async () => {
      const calls: unknown[] = []
      const handler = new OpenAPIHandler(createRouter(calls), { plugins: [new GetMethodCsrfProtectionHandlerPlugin()] })
      const { response } = await run(handler, crossSiteUrlencodedForm())
      expect(response?.status).toBe(200)
      expect(calls).toEqual([{ input: { to: 'attacker', amount: 1000 }, user: 'victim' }])
    })

    it('blocks a cross-site urlencoded form with the CSRF protection plugin', async () => {
      const calls: unknown[] = []
      const handler = new OpenAPIHandler(createRouter(calls), {
        plugins: [new CsrfProtectionHandlerPlugin(), new GetMethodCsrfProtectionHandlerPlugin()],
      })
      const { matched, response } = await run(handler, crossSiteUrlencodedForm())
      expect(matched).toBe(true)
      expect(response?.status).toBe(403)
      expect(calls).toEqual([])
    })

    it('blocks a cross-site form overriding its method with the CSRF protection plugin', async () => {
      const calls: unknown[] = []
      const handler = new OpenAPIHandler(createRouter(calls, 'DELETE'), {
        plugins: [new MethodOverrideHandlerPlugin(), new CsrfProtectionHandlerPlugin()],
      })
      const { matched, response } = await run(handler, crossSiteUrlencodedForm('?method=DELETE'))
      expect(matched).toBe(true)
      expect(response?.status).toBe(403)
      expect(calls).toEqual([])
    })
  })
})
