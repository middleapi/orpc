import type { StandardLinkPlugin } from '@orpc/client/standard'
import { createORPCClient } from '@orpc/client'
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
    detailed: os
      .meta(openapi({ method: 'PATCH', path: '/detailed', inputStructure: 'detailed' }))
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

  describe('header names', () => {
    const requests: Request[] = []

    const client = createORPCClient(new OpenAPILink(router, {
      origin: 'http://localhost:3000',
      url: '/api',
      fetch: async (url, init) => {
        const request = new Request(url, init)
        requests.push(request)

        const { matched, response } = await handler.handle(request, {
          prefix: '/api',
        })

        if (!matched || !response) {
          throw new Error('No procedure match')
        }

        return response
      },
    })) as any

    beforeEach(() => {
      requests.length = 0
    })

    it('lets the JSON body decide content-type when detailed headers use a different casing', async () => {
      const output = await client.detailed({
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: { data: { type: 'planets' } },
      })

      expect(requests[0]!.headers.get('content-type')).toBe('application/json')
      expect(output.headers['content-type']).toBe('application/json')
      expect(output.body).toEqual({ data: { type: 'planets' } })
    })

    it('lets fetch set the multipart boundary when detailed headers use a different casing', async () => {
      const output = await client.detailed({
        headers: { 'Content-Type': 'multipart/form-data' },
        body: { file: new File(['hello'], 'hello.txt', { type: 'text/plain' }) },
      })

      expect(requests[0]!.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/)
      expect(output.body).toEqual({ file: expect.any(File) })
      await expect(output.body.file.text()).resolves.toBe('hello')
    })

    it('sends headers from a Headers instance in detailed input', async () => {
      const output = await client.detailed({
        headers: new Headers({ 'X-Token': 'abc' }),
        body: { a: 1 },
      })

      expect(requests[0]!.headers.get('x-token')).toBe('abc')
      expect(output.headers['x-token']).toBe('abc')
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
})
