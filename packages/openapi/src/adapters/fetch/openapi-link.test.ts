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
})

describe('openapiLink ↔ openapiHandler path round-trips', () => {
  function createClient(router: Record<string, any>) {
    const handler = new OpenAPIHandler(router)

    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      const request = new Request(url, init)
      const { matched, response } = await handler.handle(request, { prefix: '/api' })

      return matched ? response : new Response('Not Found', { status: 404 })
    })

    const client = createORPCClient(new OpenAPILink(router, {
      fetch,
      origin: 'http://localhost:3000',
      url: '/api',
    })) as any

    return { client, fetch }
  }

  it('keeps literal ":" and braces in explicit paths as static text', async () => {
    const { client, fetch } = createClient({
      batchGet: os
        .meta(openapi({ method: 'POST', path: '/users:batchGet' }))
        .handler(({ input }) => ({ op: 'batchGet', input })),
      batchDelete: os
        .meta(openapi({ method: 'POST', path: '/users:batchDelete' }))
        .handler(({ input }) => ({ op: 'batchDelete', input })),
      bulk: os
        .meta(openapi({ method: 'POST', path: '/items:bulk' }))
        .handler(({ input }) => ({ op: 'bulk', input })),
      dotted: os
        .meta(openapi({ method: 'GET', path: '/users/{user.id}' }))
        .handler(() => ({ op: 'dotted' })),
    })

    await expect(client.batchGet({ ids: [1] })).resolves.toEqual({ op: 'batchGet', input: { ids: [1] } })
    await expect(client.batchDelete({ ids: [1] })).resolves.toEqual({ op: 'batchDelete', input: { ids: [1] } })
    await expect(client.bulk([1, 2])).resolves.toEqual({ op: 'bulk', input: [1, 2] })
    await expect(client.dotted()).resolves.toEqual({ op: 'dotted' })

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'http://localhost:3000/api/users:batchGet',
      'http://localhost:3000/api/users:batchDelete',
      'http://localhost:3000/api/items:bulk',
      'http://localhost:3000/api/users/{user.id}',
    ])
  })

  it('matches explicit paths with non-ASCII characters and spaces', async () => {
    const { client } = createClient({
      cafe: os
        .meta(openapi({ method: 'GET', path: '/café/{id}' }))
        .handler(({ input }) => ({ op: 'cafe', input })),
      spaced: os
        .meta(openapi({ method: 'GET', path: '/my files/{name}' }))
        .handler(({ input }) => ({ op: 'spaced', input })),
      prefixed: os
        .meta(openapi({ method: 'GET', prefix: '/ünïcode', path: '/{+path}' }))
        .handler(({ input }) => ({ op: 'prefixed', input })),
    })

    await expect(client.cafe({ id: 'crème brûlée' })).resolves.toEqual({ op: 'cafe', input: { id: 'crème brûlée' } })
    await expect(client.spaced({ name: 'résumé.pdf' })).resolves.toEqual({ op: 'spaced', input: { name: 'résumé.pdf' } })
    await expect(client.prefixed({ path: 'a b/ç' })).resolves.toEqual({ op: 'prefixed', input: { path: 'a b/ç' } })
  })

  it('rejects a slash-allowing param that is not the last segment on both sides', async () => {
    const router = {
      meta: os
        .meta(openapi({ method: 'GET', path: '/files/{+path}/meta' }))
        .handler(() => 'meta'),
    }

    expect(() => new OpenAPIHandler(router)).toThrowError(
      'The "{+path}" param must be the last segment of path "/files/{+path}/meta"',
    )

    const fetch = vi.fn()
    const client = createORPCClient(new OpenAPILink(router, { fetch, origin: 'http://localhost:3000', url: '/api' })) as any

    await expect(client.meta({ path: 'a/b' })).rejects.toThrowError(
      'The "{+path}" param must be the last segment of path "/files/{+path}/meta"',
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('routes each trailing slash-allowing param to its own procedure', async () => {
    const { client } = createClient({
      meta: os
        .meta(openapi({ method: 'GET', path: '/files/meta/{+path}' }))
        .handler(({ input }) => ({ op: 'meta', input })),
      content: os
        .meta(openapi({ method: 'GET', path: '/files/content/{+path}' }))
        .handler(({ input }) => ({ op: 'content', input })),
    })

    await expect(client.meta({ path: 'a/b' })).resolves.toEqual({ op: 'meta', input: { path: 'a/b' } })
    await expect(client.content({ path: 'a/b' })).resolves.toEqual({ op: 'content', input: { path: 'a/b' } })
  })

  it('never lets a path param resolve to a "." or ".." segment', async () => {
    const removeMember = vi.fn(({ input }) => ({ op: 'removeMember', input }))
    const deleteOrg = vi.fn(({ input }) => ({ op: 'deleteOrg', input }))
    const readFile = vi.fn(({ input }) => ({ op: 'readFile', input }))
    const admin = vi.fn(() => ({ op: 'admin' }))

    const { client, fetch } = createClient({
      removeMember: os.meta(openapi({ method: 'DELETE', path: '/orgs/{orgId}/members/{memberId}' })).handler(removeMember),
      deleteOrg: os.meta(openapi({ method: 'DELETE', path: '/orgs/{orgId}' })).handler(deleteOrg),
      readFile: os.meta(openapi({ method: 'GET', path: '/files/{+path}' })).handler(readFile),
      admin: os.meta(openapi({ method: 'GET', path: '/admin' })).handler(admin),
    })

    await expect(client.removeMember({ orgId: 'acme', memberId: '..' })).rejects.toThrowError(
      'Path param "memberId" cannot be or contain a "." or ".." segment in call to procedure (removeMember).',
    )
    await expect(client.removeMember({ orgId: 'acme', memberId: '.' })).rejects.toThrowError(
      'Path param "memberId" cannot be or contain a "." or ".." segment in call to procedure (removeMember).',
    )
    await expect(client.readFile({ path: '../admin' })).rejects.toThrowError(
      'Path param "path" cannot be or contain a "." or ".." segment in call to procedure (readFile).',
    )

    expect(fetch).not.toHaveBeenCalled()
    expect(deleteOrg).not.toHaveBeenCalled()
    expect(admin).not.toHaveBeenCalled()

    // dots inside a segment are ordinary text and reach the intended procedure unchanged
    await expect(client.removeMember({ orgId: 'acme', memberId: '...' })).resolves.toEqual({
      op: 'removeMember',
      input: { orgId: 'acme', memberId: '...' },
    })
    await expect(client.removeMember({ orgId: 'acme', memberId: '../x' })).resolves.toEqual({
      op: 'removeMember',
      input: { orgId: 'acme', memberId: '../x' },
    })
    await expect(client.readFile({ path: '.config/a..b' })).resolves.toEqual({
      op: 'readFile',
      input: { path: '.config/a..b' },
    })

    expect(deleteOrg).not.toHaveBeenCalled()
    expect(admin).not.toHaveBeenCalled()
  })
})
