import type { OpenRPCDocument } from '../../types'
import type { OpenRPCHandlerOptions } from '../fetch'
import { ORPCError } from '@orpc/client'
import { os } from '@orpc/server'
import { OpenRPCHandler } from '../fetch'

describe('standardOpenRPCHandler discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function createSpec(title = 'Planets'): OpenRPCDocument {
    return { openrpc: '1.3.2', info: { title, version: '1.0.0' }, methods: [] }
  }

  const discover = vi.fn()
  const router = { rpc: { discover: os.handler(discover) }, planet: { find: os.handler(() => 'Earth') } }

  function createHandler(options: OpenRPCHandlerOptions<any> = {}) {
    return new OpenRPCHandler(router, options)
  }

  async function post(handler: OpenRPCHandler<any>, body: unknown, prefix: `/${string}` = '/rpc') {
    const { response } = await handler.handle(new Request(`http://localhost${prefix}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }), { prefix, context: { user: 'alice' } })

    return { status: response!.status, json: response!.status === 204 ? undefined : await response!.json() }
  }

  it('answers rpc.discover in single, batch and notification requests, never calling a user rpc.discover procedure', async () => {
    const spec = createSpec()
    const handler = createHandler({ discovery: { spec: () => spec } })

    await expect(post(handler, { jsonrpc: '2.0', method: 'rpc.discover', id: 1 })).resolves.toEqual({
      status: 200,
      json: { jsonrpc: '2.0', id: 1, result: spec },
    })
    await expect(post(handler, [{ jsonrpc: '2.0', method: 'rpc.discover', id: 1 }, { jsonrpc: '2.0', method: 'planet.find', id: 2 }])).resolves.toEqual({
      status: 200,
      json: [{ jsonrpc: '2.0', id: 1, result: spec }, { jsonrpc: '2.0', id: 2, result: 'Earth' }],
    })
    await expect(post(handler, { jsonrpc: '2.0', method: 'rpc.discover' })).resolves.toEqual({ status: 204, json: undefined })
    expect(discover).not.toHaveBeenCalled()
  })

  it('passes the routed context, prefix and request to spec', async () => {
    const spec = vi.fn(() => createSpec())
    const handler = createHandler({ discovery: { spec } })

    await post(handler, { jsonrpc: '2.0', method: 'rpc.discover', id: 1 })

    expect(spec).toHaveBeenCalledExactlyOnceWith({ context: { user: 'alice' }, prefix: '/rpc', request: expect.objectContaining({ url: '/rpc' }) })
  })

  it('answers rpc.discover with -32601 without the discovery option', async () => {
    await expect(post(createHandler(), { jsonrpc: '2.0', method: 'rpc.discover', id: 1 })).resolves.toEqual({
      status: 200,
      json: { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } },
    })
    expect(discover).not.toHaveBeenCalled()
  })

  it('answers the errors thrown by spec, so spec can guard the document', async () => {
    const handler = createHandler({
      discovery: {
        spec: ({ context }) => {
          if (context.user !== 'admin') {
            throw new ORPCError('FORBIDDEN')
          }

          return createSpec()
        },
      },
    })

    expect((await post(handler, { jsonrpc: '2.0', method: 'rpc.discover', id: 1 })).json).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32003, message: 'Forbidden', data: { code: 'FORBIDDEN', defined: false } },
    })
  })

  it('rethrows unexpected spec errors for a single call, and answers -32603 in a batch', async ({ onTestFinished }) => {
    const rejectSpy = vi.spyOn(Promise, 'reject').mockImplementation(() => new Promise(() => {}) as Promise<never>)

    onTestFinished(() => {
      rejectSpy.mockRestore()
    })

    const handler = createHandler({
      discovery: {
        spec: () => {
          throw new TypeError('generator bug')
        },
      },
    })

    await expect(post(handler, { jsonrpc: '2.0', method: 'rpc.discover', id: 1 })).rejects.toThrow('generator bug')
    expect(rejectSpy).not.toHaveBeenCalled()

    expect((await post(handler, [{ jsonrpc: '2.0', method: 'rpc.discover', id: 1 }, { jsonrpc: '2.0', method: 'planet.find', id: 2 }])).json).toEqual([
      { jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Internal error' } },
      { jsonrpc: '2.0', id: 2, result: 'Earth' },
    ])
    expect(rejectSpy).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'generator bug' }))
  })

  it('answers the GET of a document spec refuses with the status of the error', async () => {
    const handler = createHandler({
      discovery: {
        spec: () => {
          throw new ORPCError('FORBIDDEN')
        },
      },
    })

    const { response } = await handler.handle(new Request('http://localhost/rpc/openrpc.json'), { prefix: '/rpc' })

    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toMatchObject({ id: null, error: { code: -32003, data: { code: 'FORBIDDEN' } } })
  })

  it('serves the document over GET at /openrpc.json under the prefix', async () => {
    const spec = createSpec()
    const handler = createHandler({ discovery: { spec } })

    const { response } = await handler.handle(new Request('http://localhost/rpc/openrpc.json?pretty'), { prefix: '/rpc' })

    expect(response?.status).toBe(200)
    expect(response?.headers.get('content-type')).toContain('application/json')
    await expect(response?.json()).resolves.toEqual(spec)

    // without a prefix
    await expect((await createHandler({ discovery: { spec } }).handle(new Request('http://localhost/openrpc.json'))).response?.json()).resolves.toEqual(spec)
  })

  it('serves the document from a custom spec path relative to the prefix', async () => {
    const spec = vi.fn(async () => createSpec('Custom'))
    const handler = createHandler({ discovery: { spec, specPath: '/spec.json' } })

    const { response } = await handler.handle(new Request('http://localhost/rpc/spec.json'), { prefix: '/rpc', context: { user: 'alice' } })

    await expect(response?.json()).resolves.toEqual(createSpec('Custom'))
    expect(spec).toHaveBeenCalledExactlyOnceWith({ context: { user: 'alice' }, prefix: '/rpc', request: expect.objectContaining({ url: '/rpc/spec.json' }) })

    for (const url of ['http://localhost/spec.json', 'http://localhost/rpc/openrpc.json']) {
      expect((await handler.handle(new Request(url), { prefix: '/rpc' })).matched).toBe(false)
    }
  })

  it('disables the GET endpoint with specPath false but still answers rpc.discover', async () => {
    const handler = createHandler({ discovery: { spec: createSpec(), specPath: false } })

    expect((await handler.handle(new Request('http://localhost/rpc/openrpc.json'), { prefix: '/rpc' })).matched).toBe(false)
    expect((await post(handler, { jsonrpc: '2.0', method: 'rpc.discover', id: 1 })).json).toMatchObject({ result: createSpec() })
  })

  it.each([
    ['POST', 'http://localhost/rpc/openrpc.json'],
    ['GET', 'http://localhost/rpc/other.json'],
    ['GET', 'http://localhost/rpc'],
  ])('does not serve %s %s', async (method, url) => {
    const spec = vi.fn(() => createSpec())
    const handler = createHandler({ discovery: { spec } })

    expect((await handler.handle(new Request(url, { method }), { prefix: '/rpc' })).matched).toBe(false)
    expect(spec).not.toHaveBeenCalled()
  })

  it('runs inside the routing interceptors, which can guard the whole request', async () => {
    const spec = createSpec()
    const handler = createHandler({
      routingInterceptors: [async ({ next, request }) => request.headers.authorization ? next() : { matched: false }],
      discovery: { spec },
    })

    expect((await handler.handle(new Request('http://localhost/openrpc.json'))).matched).toBe(false)

    const { response } = await handler.handle(new Request('http://localhost/openrpc.json', { headers: { authorization: 'token' } }))

    await expect(response?.json()).resolves.toEqual(spec)
  })
})
