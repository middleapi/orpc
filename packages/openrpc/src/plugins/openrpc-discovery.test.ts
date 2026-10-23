import type { StandardHandlerRoutingInterceptor } from '@orpc/server/standard'
import type { JsonRpcCall } from '../adapters/standard/utils'
import type { OpenRPCDocument } from '../types'
import { os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { OpenRPCHandler } from '../adapters/fetch'
import { getJsonRpcCall, JSON_RPC_CALL_SYMBOL } from '../adapters/standard/utils'
import { OpenRPCDiscoveryHandlerPlugin } from './openrpc-discovery'

describe('openRPCDiscoveryHandlerPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function createSpec(title = 'Planets'): OpenRPCDocument {
    return { openrpc: '1.3.2', info: { title, version: '1.0.0' }, methods: [] }
  }

  function getInterceptor(plugin: OpenRPCDiscoveryHandlerPlugin<any>, options: Record<string, unknown> = {}) {
    const initialized = plugin.init(options as any)
    const interceptor = initialized.routingInterceptors?.at(-1)

    expect(interceptor).toBeDefined()

    return { initialized, interceptor: interceptor! }
  }

  async function invoke(
    interceptor: StandardHandlerRoutingInterceptor<any>,
    { url, method = 'GET', prefix, call, nextResult = { matched: false as const } }: {
      url: `/${string}`
      method?: string
      prefix?: `/${string}`
      call?: JsonRpcCall
      nextResult?: any
    },
  ) {
    const next = vi.fn().mockResolvedValue(nextResult)
    const request = { method, url, headers: {}, signal: undefined, resolveBody: vi.fn(), ...call && { [JSON_RPC_CALL_SYMBOL]: call } }
    const result = await interceptor({ next, context: {}, prefix, request } as any)

    return { next, request, result }
  }

  it('preserves existing routing interceptors and returns the matched result from next untouched', async () => {
    const spec = vi.fn(() => createSpec())
    const existing = vi.fn(({ next }) => next())
    const { initialized, interceptor } = getInterceptor(new OpenRPCDiscoveryHandlerPlugin({ spec }), { routingInterceptors: [existing] })
    const nextResult = { matched: true, response: { status: 200, headers: {}, body: 'handled' } }

    expect(initialized.routingInterceptors).toEqual([existing, interceptor])

    const { next, result } = await invoke(interceptor, { url: '/openrpc.json', nextResult })

    expect(next).toHaveBeenCalledOnce()
    expect(result).toBe(nextResult)
    expect(spec).not.toHaveBeenCalled()
  })

  it('answers rpc.discover calls without calling next, passing the routing options to spec', async () => {
    const spec = vi.fn(() => createSpec())
    const { interceptor } = getInterceptor(new OpenRPCDiscoveryHandlerPlugin({ spec }))

    const { next, request, result } = await invoke(interceptor, {
      method: 'POST',
      url: '/rpc/rpc/discover',
      prefix: '/rpc',
      call: { method: 'rpc.discover', id: 1 },
    })

    expect(result).toEqual({ matched: true, response: { status: 200, headers: {}, body: { result: createSpec() } } })
    expect(next).not.toHaveBeenCalled()
    expect(spec).toHaveBeenCalledExactlyOnceWith({ context: {}, prefix: '/rpc', request })
  })

  it('passes other JSON-RPC calls through', async () => {
    const spec = vi.fn(() => createSpec())
    const { interceptor } = getInterceptor(new OpenRPCDiscoveryHandlerPlugin({ spec }))
    const nextResult = { matched: true, response: { status: 200, headers: {}, body: { result: 'Earth' } } }

    const { result } = await invoke(interceptor, { method: 'POST', url: '/planet/find', call: { method: 'planet.find', id: 1 }, nextResult })

    expect(result).toBe(nextResult)
    expect(spec).not.toHaveBeenCalled()
  })

  it('serves a static document over GET at /openrpc.json once nothing else matched', async () => {
    const { interceptor } = getInterceptor(new OpenRPCDiscoveryHandlerPlugin({ spec: createSpec() }))

    const { next, result } = await invoke(interceptor, { url: '/openrpc.json' })

    expect(next).toHaveBeenCalledOnce()
    expect(result).toEqual({ matched: true, response: { status: 200, headers: {}, body: createSpec() } })
  })

  it('serves the document from a custom spec path relative to the prefix', async () => {
    const spec = vi.fn(async () => createSpec('Custom'))
    const { interceptor } = getInterceptor(new OpenRPCDiscoveryHandlerPlugin({ spec, specPath: '/spec.json' }))

    const { request, result } = await invoke(interceptor, { url: '/rpc/spec.json?pretty', prefix: '/rpc' })

    expect(result.response?.body).toEqual(createSpec('Custom'))
    expect(spec).toHaveBeenCalledExactlyOnceWith({ context: {}, prefix: '/rpc', request })

    for (const url of ['/spec.json', '/rpc/openrpc.json'] as const) {
      expect((await invoke(interceptor, { url, prefix: '/rpc' })).result).toEqual({ matched: false })
    }
  })

  it.each([
    ['POST', '/openrpc.json'],
    ['GET', '/other.json'],
  ])('does not serve %s %s', async (method, url) => {
    const spec = vi.fn(() => createSpec())
    const { interceptor } = getInterceptor(new OpenRPCDiscoveryHandlerPlugin({ spec }))
    const nextResult = { matched: false }

    expect((await invoke(interceptor, { method, url: url as `/${string}`, nextResult })).result).toBe(nextResult)
    expect(spec).not.toHaveBeenCalled()
  })

  it('disables the GET endpoint with specPath false but still answers rpc.discover', async () => {
    const { interceptor } = getInterceptor(new OpenRPCDiscoveryHandlerPlugin({ spec: createSpec(), specPath: false }))

    expect((await invoke(interceptor, { url: '/openrpc.json' })).result).toEqual({ matched: false })
    expect((await invoke(interceptor, { method: 'POST', url: '/', call: { method: 'rpc.discover', id: 1 } })).result.matched).toBe(true)
  })

  describe('with handlers', () => {
    const spec = createSpec()
    const discover = vi.fn()

    function post(handler: OpenRPCHandler<any> | RPCHandler<any>, body: unknown) {
      return handler.handle(new Request('http://localhost/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }), { prefix: '/rpc' })
    }

    it('answers rpc.discover in single, batch and notification requests, never calling a user rpc.discover procedure', async () => {
      const handler = new OpenRPCHandler({ rpc: { discover: os.handler(discover) }, planet: { find: os.handler(() => 'Earth') } }, {
        plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec: () => spec })],
      })

      await expect((await post(handler, { jsonrpc: '2.0', method: 'rpc.discover', id: 1 })).response?.json())
        .resolves
        .toEqual({ jsonrpc: '2.0', id: 1, result: spec })
      await expect((await post(handler, [{ jsonrpc: '2.0', method: 'rpc.discover', id: 1 }, { jsonrpc: '2.0', method: 'planet.find', id: 2 }])).response?.json())
        .resolves
        .toEqual([{ jsonrpc: '2.0', id: 1, result: spec }, { jsonrpc: '2.0', id: 2, result: 'Earth' }])
      expect((await post(handler, { jsonrpc: '2.0', method: 'rpc.discover' })).response?.status).toBe(204)
      expect(discover).not.toHaveBeenCalled()
    })

    it('serves the document over GET under the prefix', async () => {
      const handler = new OpenRPCHandler({}, { plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec })] })

      const { response } = await handler.handle(new Request('http://localhost/rpc/openrpc.json'), { prefix: '/rpc' })

      expect(response?.status).toBe(200)
      expect(response?.headers.get('content-type')).toContain('application/json')
      await expect(response?.json()).resolves.toEqual(spec)
    })

    it('runs after user routing interceptors, so they can guard discovery', async () => {
      const guard = vi.fn<StandardHandlerRoutingInterceptor<any>>(async ({ next, request }) =>
        request.headers.authorization ? next() : { matched: false })
      const handler = new OpenRPCHandler({}, {
        routingInterceptors: [guard],
        plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec })],
      })

      await expect((await post(handler, { jsonrpc: '2.0', method: 'rpc.discover', id: 1 })).response?.json())
        .resolves
        .toEqual({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } })
      expect(getJsonRpcCall(guard.mock.calls[0]![0].request)).toEqual({ method: 'rpc.discover', id: 1 })
      expect((await handler.handle(new Request('http://localhost/openrpc.json'))).matched).toBe(false)

      const { response } = await handler.handle(new Request('http://localhost/openrpc.json', { headers: { authorization: 'token' } }))

      await expect(response?.json()).resolves.toEqual(spec)
    })

    it('serves only the GET document when mounted on RPCHandler', async () => {
      const handler = new RPCHandler({}, { plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec, specPath: '/spec.json' })] })

      const { response } = await handler.handle(new Request('http://localhost/rpc/spec.json'), { prefix: '/rpc' })

      await expect(response?.json()).resolves.toEqual(spec)
      expect((await post(handler, { jsonrpc: '2.0', method: 'rpc.discover', id: 1 })).matched).toBe(false)
    })
  })
})
