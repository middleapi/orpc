import type { StandardLinkPlugin } from '@orpc/client/standard'
import { createORPCClient, MalformedResponseError, ORPCError } from '@orpc/client'
import { os } from '@orpc/server'
import { openapi } from '../../meta'
import { OpenAPIHandler } from './openapi-handler'
import { OpenAPILink } from './openapi-link'

describe('openapiLink', () => {
  const date = new Date('2024-01-02T03:04:05.000Z')
  const blob = new Blob(['hello'], { type: 'text/plain' })

  const router = {
    get: os
      .meta(openapi({ method: 'GET', path: '/ping/{pong}' }))
      .handler(({ input }) => input),
    post: os.handler(({ input }) => input),
    query: os
      .meta(openapi({ method: 'QUERY', path: '/query' }))
      .handler(({ input }) => input),
  }

  const handler = new OpenAPIHandler(router)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls a GET OpenAPI endpoint through fetch transport', async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      const request = new Request(url, init)
      const { matched, response } = await handler.handle(request, {
        prefix: '/api',
      })

      if (!matched || !response) {
        throw new Error('No procedure match')
      }

      return response
    })

    const client = createORPCClient(new OpenAPILink(router, {
      fetch,
      origin: 'http://localhost:3000',
      url: '/api',
    })) as any

    await expect(client.get({
      pong: 'pong',
      a: 1,
      nested: {
        date,
        arr: [3, date],
      },
    })).resolves.toEqual({
      pong: 'pong',
      a: '1',
      nested: {
        date: date.toISOString(),
        arr: ['3', date.toISOString()],
      },
    })

    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('http://localhost:3000/api/ping/pong'),
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
      }),
      expect.objectContaining({ context: {} }),
      ['get'],
    )
  })

  it('calls a POST OpenAPI endpoint with JSON payloads', async () => {
    const client = createORPCClient(new OpenAPILink(router, {
      origin: 'http://localhost:3000',
      url: '/api',
      fetch: async (url, init) => {
        const request = new Request(url, init)
        const { matched, response } = await handler.handle(request, {
          prefix: '/api',
        })

        if (!matched || !response) {
          throw new Error('No procedure match')
        }

        return response
      },
    })) as any

    await expect(client.post({
      a: 1,
      b: 2,
      nested: {
        date,
        arr: [3, date],
      },
    })).resolves.toEqual({
      a: 1,
      b: 2,
      nested: {
        date: date.toISOString(),
        arr: [3, date.toISOString()],
      },
    })
  })

  it('calls a QUERY OpenAPI endpoint with body-encoded input', async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      const request = new Request(url, init)

      await expect(request.clone().json()).resolves.toEqual({ search: 'earth' })

      const { matched, response } = await handler.handle(request, {
        prefix: '/api',
      })

      if (!matched || !response) {
        throw new Error('No procedure match')
      }

      return response
    })

    const client = createORPCClient(new OpenAPILink(router, {
      fetch,
      origin: 'http://localhost:3000',
      url: '/api',
    })) as any

    await expect(client.query({ search: 'earth' })).resolves.toEqual({ search: 'earth' })

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/query',
      expect.objectContaining({ method: 'QUERY' }),
      expect.objectContaining({ context: {} }),
      ['query'],
    )
  })

  it('calls a POST OpenAPI endpoint with multipart payloads', async () => {
    const client = createORPCClient(new OpenAPILink(router, {
      origin: 'http://localhost:3000',
      url: '/api',
      fetch: async (url, init) => {
        const request = new Request(url, init)
        const { matched, response } = await handler.handle(request, {
          prefix: '/api',
        })

        if (!matched || !response) {
          throw new Error('No procedure match')
        }

        return response
      },
    })) as any

    await expect(client.post({
      a: 1,
      nested: {
        date,
        arr: [3, date],
      },
      blob,
    })).resolves.toEqual({
      a: '1',
      nested: {
        date: date.toISOString(),
        arr: ['3', date.toISOString()],
      },
      blob: expect.any(File),
    })
  })

  it('supports standard link plugins', async () => {
    const plugin: StandardLinkPlugin<any> = {
      name: 'test',
      init() {
        return {
          transportInterceptors: [
            async () => ({
              status: 200,
              headers: {},
              resolveBody: async () => 'intercepted',
            }),
          ],
        }
      },
    }

    const client = createORPCClient(new OpenAPILink(router, {
      plugins: [plugin],
    })) as any

    await expect(client.post('ignored')).resolves.toBe('intercepted')
  })

  it('throws on a status-0 response, which browsers return for redirects', async () => {
    // `Response.error()` has the same shape as a browser opaque-redirect response: status 0, no headers, no body.
    const fetch = vi.fn(async () => Response.error())

    const client = createORPCClient(new OpenAPILink(router, {
      fetch,
      origin: 'http://localhost:3000',
      url: '/api',
    })) as any

    const error = await client.get({ pong: 'pong' }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ORPCError)
    expect(error.code).toBe('MALFORMED_ORPC_RESPONSE')
    expect(error.message).toContain('opaque response')
    expect(error.data).toEqual({ status: 0, headers: {}, body: undefined })
    expect(error.cause).toBeInstanceOf(MalformedResponseError)
  })

  it('returns a real 3xx response as output when fetch exposes it', async () => {
    const redirectRouter = {
      redirect: os
        .meta(openapi({ method: 'GET', path: '/redirect', successStatus: 307, outputStructure: 'detailed' }))
        .handler(() => ({ headers: { location: 'https://orpc.dev' } })),
    }

    const redirectHandler = new OpenAPIHandler(redirectRouter)

    const client = createORPCClient(new OpenAPILink(redirectRouter, {
      origin: 'http://localhost:3000',
      url: '/api',
      fetch: async (url, init) => {
        const { matched, response } = await redirectHandler.handle(new Request(url, init), { prefix: '/api' })

        if (!matched || !response) {
          throw new Error('No procedure match')
        }

        return response
      },
    })) as any

    await expect(client.redirect()).resolves.toEqual({
      status: 307,
      headers: expect.objectContaining({ location: 'https://orpc.dev' }),
      body: undefined,
    })
  })
})
