import { openapi } from '@orpc/openapi'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { EvlogHandlerPlugin } from './handler-plugin'

/**
 * Kept apart from handler-plugin.test.ts, which mocks `evlog/toolkit` for the whole file.
 */
describe('evlogHandlerPlugin path filters use the canonical pathname', () => {
  function createRequest(url: string) {
    return new Request(url, {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    })
  }

  it.each([
    'http://localhost/rpc/admin/deleteUser',
    'http://localhost/rpc/%61dmin/deleteUser',
    'http://localhost/rpc/admin/deleteUs%65r',
    'http://localhost/rpc/admin/deleteUser/',
  ])('rpc: logs %s, which routes to an included procedure', async (url) => {
    const execute = vi.fn(() => 'deleted')
    const router = { admin: { deleteUser: os.handler(execute) } }
    const drain = vi.fn()
    const handler = new RPCHandler(router, {
      plugins: [new EvlogHandlerPlugin({ include: ['/rpc/admin/deleteUser'], drain })],
    })

    const { matched, response } = await handler.handle(createRequest(url), { prefix: '/rpc' })

    expect(matched).toBe(true)
    expect(response?.status).toBe(200)
    expect(execute).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(1))
    expect(drain.mock.calls[0]![0].event.path).toBe('/rpc/admin/deleteUser')
  })

  it.each([
    ['http://localhost/api/admin/delete-user', '/api/admin/**'],
    ['http://localhost/api/%61dmin/delete-user', '/api/admin/**'],
    ['http://localhost/api/admin/delete-user', '/api/admin/delete-user'],
    ['http://localhost/api/admin/delete-user/', '/api/admin/delete-user'],
  ])('openapi: logs %s, which routes to a procedure included by %s', async (url, include) => {
    const execute = vi.fn(() => 'deleted')
    const router = {
      admin: {
        deleteUser: os.meta(openapi({ method: 'POST', path: '/admin/delete-user' })).handler(execute),
      },
    }
    const drain = vi.fn()
    const handler = new OpenAPIHandler(router, {
      plugins: [new EvlogHandlerPlugin({ include: [include], drain })],
    })

    const { matched, response } = await handler.handle(createRequest(url), { prefix: '/api' })

    expect(matched).toBe(true)
    expect(response?.status).toBe(200)
    expect(execute).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(1))
    expect(drain.mock.calls[0]![0].event.path).toBe('/api/admin/delete-user')
  })

  it('applies exclude to the canonical pathname', async () => {
    const execute = vi.fn(() => 'pong')
    const router = { health: os.handler(execute) }
    const drain = vi.fn()
    const handler = new RPCHandler(router, {
      plugins: [new EvlogHandlerPlugin({ exclude: ['/rpc/health'], drain })],
    })

    await handler.handle(createRequest('http://localhost/rpc/h%65alth/'), { prefix: '/rpc' })
    await handler.handle(createRequest('http://localhost/rpc/missing'), { prefix: '/rpc' })

    expect(execute).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(1))
    expect(drain.mock.calls[0]![0].event.path).toBe('/rpc/missing')
  })
})
