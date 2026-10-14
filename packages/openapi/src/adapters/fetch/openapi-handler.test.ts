import type { StandardHandlerPlugin } from '@orpc/server/standard'
import { createORPCClient } from '@orpc/client'
import { onError, os } from '@orpc/server'
import z from 'zod'
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
})

describe('openapiHandler: invalid detailed-output headers', () => {
  const router = {
    download: os
      .meta(openapi({ method: 'GET', path: '/download', outputStructure: 'detailed' }))
      .input(z.object({ name: z.string() }))
      .handler(({ input }) => ({
        headers: { 'content-disposition': `attachment; filename="${input.name}"` },
        body: 'file-content',
      })),
    redirect: os
      .meta(openapi({ method: 'GET', path: '/redirect', successStatus: 307, outputStructure: 'detailed' }))
      .input(z.object({ to: z.string().startsWith('/') }))
      .handler(({ input }) => ({ headers: { location: input.to } })),
  }

  it.each([
    ['http://localhost/api/download?name=%E6%97%A5.txt'], // code point above U+00FF
    ['http://localhost/api/redirect?to=%2F%0D%0ASet-Cookie:%20a=b'], // CRLF
  ])('responds 500 and calls onError instead of rejecting for %s', async (url) => {
    const onErrorSpy = vi.fn()
    const handler = new OpenAPIHandler(router, { interceptors: [onError(onErrorSpy)] })

    const { matched, response } = await handler.handle(new Request(url), { prefix: '/api' })

    expect(matched).toBe(true)
    expect(response!.status).toBe(500)
    expect(onErrorSpy).toHaveBeenCalledTimes(1)
  })

  it('still sends valid headers', async () => {
    const handler = new OpenAPIHandler(router)

    const { response } = await handler.handle(new Request('http://localhost/api/download?name=a.txt'), { prefix: '/api' })

    expect(response!.status).toBe(200)
    expect(response!.headers.get('content-disposition')).toBe('attachment; filename="a.txt"')
  })
})
