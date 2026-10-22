import type { StandardHandlerRoutingInterceptorOptions } from '@orpc/server/standard'
import type { Tracer, TracingAttributeValue, TracingSpan } from '@orpc/shared'
import type { JsonRpcCallRequest } from '../adapters/standard/call'
import type { OpenRPCDocument } from '../types'
import { AsyncLocalStorage } from 'node:async_hooks'
import { openapi } from '@orpc/openapi'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { getTracer, setTracer } from '@orpc/shared'
import { z } from 'zod'
import { OpenRPCHandler } from '../adapters/fetch'
import { getJsonRpcCall, JSON_RPC_CALL_SYMBOL } from '../adapters/standard/call'
import { OpenRPCDiscoveryHandlerPlugin } from './openrpc-discovery'

const document: OpenRPCDocument = {
  openrpc: '1.3.2',
  info: { title: 'Planets', version: '1.0.0' },
  methods: [
    { name: 'ping', params: [], result: { name: 'result', schema: { type: 'string' } } },
  ],
}

const userDiscover = vi.fn(() => 'user discover')

const router = {
  ping: os.$context<{ user?: string }>().handler(() => 'pong'),
  planet: {
    find: os.input(z.object({ id: z.number() })).handler(({ input }) => ({ id: input.id, name: 'Earth' })),
  },
  rpc: {
    discover: os.handler(userDiscover),
  },
}

function createRpcRequest(body: unknown, url = 'https://example.com/rpc'): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('openRPCDiscoveryHandlerPlugin', () => {
  it('appends its routing interceptor after the existing ones', () => {
    const existing = vi.fn(({ next }) => next())
    const plugin = new OpenRPCDiscoveryHandlerPlugin({ spec: document })

    expect(plugin.name).toBe('~openrpc-discovery')
    expect(plugin).not.toHaveProperty('before')
    expect(plugin).not.toHaveProperty('after')

    const options = plugin.init({ routingInterceptors: [existing], interceptors: [] })

    expect(options.routingInterceptors).toHaveLength(2)
    expect(options.routingInterceptors![0]).toBe(existing)
    expect(options.interceptors).toEqual([])
  })

  describe('rpc.discover', () => {
    it('answers with the document', async () => {
      const spec = vi.fn(async () => document)
      const handler = new OpenRPCHandler(router, {
        plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec })],
      })

      const { matched, response } = await handler.handle(
        createRpcRequest({ jsonrpc: '2.0', method: 'rpc.discover', id: 1 }),
        { prefix: '/rpc' },
      )

      expect(matched).toBe(true)
      expect(response!.status).toBe(200)
      expect(response!.headers.get('content-type')).toBe('application/json')
      await expect(response!.json()).resolves.toEqual({ jsonrpc: '2.0', id: 1, result: document })
      expect(spec).toHaveBeenCalledOnce()
    })

    it.each([
      ['by-position params', [1, 2, 3]],
      ['by-name params', { foo: 'bar' }],
      ['empty params', []],
      ['null params', null],
    ])('ignores %s', async (_, params) => {
      const handler = new OpenRPCHandler(router, {
        plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec: document })],
      })

      const { response } = await handler.handle(
        createRpcRequest({ jsonrpc: '2.0', method: 'rpc.discover', params, id: 'a' }),
        { prefix: '/rpc' },
      )

      await expect(response!.json()).resolves.toEqual({ jsonrpc: '2.0', id: 'a', result: document })
    })

    it('answers inside a batch, in request order', async () => {
      const handler = new OpenRPCHandler(router, {
        plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec: () => document })],
      })

      const { response } = await handler.handle(
        createRpcRequest([
          { jsonrpc: '2.0', method: 'ping', id: 1 },
          { jsonrpc: '2.0', method: 'rpc.discover', id: 2 },
          { jsonrpc: '2.0', method: 'rpc.discover' },
          { jsonrpc: '2.0', method: 'planet.find', params: { id: 7 }, id: 3 },
          { jsonrpc: '2.0', method: 'rpc.unknown', id: 4 },
        ]),
        { prefix: '/rpc' },
      )

      expect(response!.status).toBe(200)
      await expect(response!.json()).resolves.toEqual([
        { jsonrpc: '2.0', id: 1, result: 'pong' },
        { jsonrpc: '2.0', id: 2, result: document },
        { jsonrpc: '2.0', id: 3, result: { id: 7, name: 'Earth' } },
        { jsonrpc: '2.0', id: 4, error: { code: -32601, message: 'Method not found' } },
      ])
    })

    it('never answers a notification', async () => {
      const handler = new OpenRPCHandler(router, {
        plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec: document })],
      })

      const { response } = await handler.handle(
        createRpcRequest({ jsonrpc: '2.0', method: 'rpc.discover' }),
        { prefix: '/rpc' },
      )

      expect(response!.status).toBe(204)
      await expect(response!.text()).resolves.toBe('')
    })

    it('never calls a user "rpc.discover" procedure', async () => {
      const allow = vi.fn(() => true)
      const handler = new OpenRPCHandler(router, {
        plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec: document, allow })],
      })

      const allowed = await handler.handle(
        createRpcRequest({ jsonrpc: '2.0', method: 'rpc.discover', id: 1 }),
        { prefix: '/rpc' },
      )

      await expect(allowed.response!.json()).resolves.toEqual({ jsonrpc: '2.0', id: 1, result: document })

      allow.mockReturnValue(false)

      const denied = await handler.handle(
        createRpcRequest({ jsonrpc: '2.0', method: 'rpc.discover', id: 2 }),
        { prefix: '/rpc' },
      )

      await expect(denied.response!.json()).resolves.toEqual({ jsonrpc: '2.0', id: 2, error: { code: -32601, message: 'Method not found' } })
      expect(userDiscover).not.toHaveBeenCalled()
    })

    it('answers "Method not found" when allow resolves to false', async () => {
      const spec = vi.fn(() => document)
      const allow = vi.fn(async () => false)
      const handler = new OpenRPCHandler(router, {
        plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec, allow })],
      })

      const { response } = await handler.handle(
        createRpcRequest([
          { jsonrpc: '2.0', method: 'rpc.discover', id: 1 },
          { jsonrpc: '2.0', method: 'ping', id: 2 },
        ]),
        { prefix: '/rpc' },
      )

      await expect(response!.json()).resolves.toEqual([
        { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } },
        { jsonrpc: '2.0', id: 2, result: 'pong' },
      ])
      expect(allow).toHaveBeenCalledOnce()
      expect(spec).not.toHaveBeenCalled()
    })

    it('passes the routing options of the call to spec and allow', async () => {
      const spec = vi.fn((_options: StandardHandlerRoutingInterceptorOptions<{ user?: string }>) => document)
      const allow = vi.fn((_options: StandardHandlerRoutingInterceptorOptions<{ user?: string }>) => true)
      const handler = new OpenRPCHandler(router, {
        plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec, allow })],
      })

      await handler.handle(
        createRpcRequest([{ jsonrpc: '2.0', method: 'rpc.discover', id: 1 }]),
        { context: { user: 'u_1' }, prefix: '/rpc' },
      )

      for (const fn of [spec, allow]) {
        expect(fn).toHaveBeenCalledOnce()
        expect(fn).toHaveBeenCalledWith({
          context: { user: 'u_1' },
          prefix: '/rpc',
          request: expect.objectContaining({ method: 'POST', url: '/rpc/rpc/discover' }),
        })
        expect(fn.mock.calls[0]![0]).not.toHaveProperty('next')
        expect(getJsonRpcCall(fn.mock.calls[0]![0].request)).toEqual({ method: 'rpc.discover', id: 1, notification: false, batch: true })
      }
    })

    it('leaves other calls to the procedures', async () => {
      const spec = vi.fn(() => document)
      const handler = new OpenRPCHandler(router, {
        plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec, specPath: '/' })],
      })

      const { response } = await handler.handle(
        createRpcRequest({ jsonrpc: '2.0', method: 'planet.find', params: { id: 1 }, id: 1 }),
        { prefix: '/rpc' },
      )

      await expect(response!.json()).resolves.toEqual({ jsonrpc: '2.0', id: 1, result: { id: 1, name: 'Earth' } })
      expect(spec).not.toHaveBeenCalled()
    })

    it('rethrows an error of spec for a single call', async () => {
      const handler = new OpenRPCHandler(router, {
        plugins: [new OpenRPCDiscoveryHandlerPlugin({
          spec: () => {
            throw new Error('generation failed')
          },
        })],
      })

      await expect(handler.handle(
        createRpcRequest({ jsonrpc: '2.0', method: 'rpc.discover', id: 1 }),
        { prefix: '/rpc' },
      )).rejects.toThrow('generation failed')
    })
  })

  describe('document over GET', () => {
    it('serves the document at "/openrpc.json" by default', async () => {
      const spec = vi.fn(() => document)
      const handler = new OpenRPCHandler(router, {
        plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec })],
      })

      for (const url of ['https://example.com/openrpc.json', 'https://example.com/openrpc.json/', 'https://example.com/openrpc.json?download=1']) {
        const { matched, response } = await handler.handle(new Request(url))

        expect(matched).toBe(true)
        expect(response!.status).toBe(200)
        expect(response!.headers.get('content-type')).toBe('application/json')
        await expect(response!.json()).resolves.toEqual(document)
      }

      for (const url of ['https://example.com/', 'https://example.com/openrpc', 'https://example.com/openrpc.json/x', 'https://example.com/v1/openrpc.json']) {
        await expect(handler.handle(new Request(url))).resolves.toEqual({ matched: false })
      }

      expect(spec).toHaveBeenCalledTimes(3)
    })

    it('serves the document relative to the prefix', async () => {
      const spec = vi.fn((_options: StandardHandlerRoutingInterceptorOptions<{ user?: string }>) => document)
      const handler = new OpenRPCHandler(router, {
        plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec })],
      })

      const { response } = await handler.handle(new Request('https://example.com/rpc/openrpc.json'), { context: { user: 'u_1' }, prefix: '/rpc' })

      await expect(response!.json()).resolves.toEqual(document)
      expect(spec).toHaveBeenCalledOnce()
      expect(spec).toHaveBeenCalledWith({
        context: { user: 'u_1' },
        prefix: '/rpc',
        request: expect.objectContaining({ method: 'GET', url: '/rpc/openrpc.json' }),
      })
      expect(getJsonRpcCall(spec.mock.calls[0]![0].request)).toBeUndefined()

      await expect(handler.handle(new Request('https://example.com/openrpc.json'), { prefix: '/rpc' })).resolves.toEqual({ matched: false })
    })

    it('serves the document at a custom specPath', async () => {
      const handler = new OpenRPCHandler(router, {
        plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec: document, specPath: '/' })],
      })

      const get = await handler.handle(new Request('https://example.com/rpc'), { prefix: '/rpc' })

      await expect(get.response!.json()).resolves.toEqual(document)

      // the same path still answers JSON-RPC calls over POST
      const post = await handler.handle(createRpcRequest({ jsonrpc: '2.0', method: 'ping', id: 1 }), { prefix: '/rpc' })

      await expect(post.response!.json()).resolves.toEqual({ jsonrpc: '2.0', id: 1, result: 'pong' })

      await expect(handler.handle(new Request('https://example.com/rpc/openrpc.json'), { prefix: '/rpc' })).resolves.toEqual({ matched: false })
    })

    it('only answers rpc.discover when specPath is false', async () => {
      const spec = vi.fn(() => document)
      const handler = new OpenRPCHandler(router, {
        plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec, specPath: false })],
      })

      await expect(handler.handle(new Request('https://example.com/rpc/openrpc.json'), { prefix: '/rpc' })).resolves.toEqual({ matched: false })
      expect(spec).not.toHaveBeenCalled()

      const { response } = await handler.handle(createRpcRequest({ jsonrpc: '2.0', method: 'rpc.discover', id: 1 }), { prefix: '/rpc' })

      await expect(response!.json()).resolves.toEqual({ jsonrpc: '2.0', id: 1, result: document })
    })

    it.each(['POST', 'PUT', 'DELETE', 'HEAD'])('does not serve %s requests at specPath', async (method) => {
      const spec = vi.fn(() => document)
      const handler = new OpenRPCHandler(router, {
        plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec })],
      })

      const request = new Request('https://example.com/rpc/openrpc.json', {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'HEAD' ? undefined : JSON.stringify({ jsonrpc: '2.0', method: 'rpc.discover', id: 1 }),
      })

      await expect(handler.handle(request, { prefix: '/rpc' })).resolves.toEqual({ matched: false })
      expect(spec).not.toHaveBeenCalled()
    })

    it('falls through when allow resolves to false, without calling it for other paths', async () => {
      const spec = vi.fn(() => document)
      const allow = vi.fn(async () => false)
      const handler = new OpenRPCHandler(router, {
        plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec, allow })],
      })

      await expect(handler.handle(new Request('https://example.com/rpc/other'), { prefix: '/rpc' })).resolves.toEqual({ matched: false })
      expect(allow).not.toHaveBeenCalled()

      await expect(handler.handle(new Request('https://example.com/rpc/openrpc.json'), { prefix: '/rpc' })).resolves.toEqual({ matched: false })
      expect(allow).toHaveBeenCalledOnce()
      expect(allow).toHaveBeenCalledWith(expect.objectContaining({
        prefix: '/rpc',
        request: expect.objectContaining({ method: 'GET', url: '/rpc/openrpc.json' }),
      }))
      expect(spec).not.toHaveBeenCalled()

      allow.mockResolvedValue(true)

      const { response } = await handler.handle(new Request('https://example.com/rpc/openrpc.json'), { prefix: '/rpc' })

      await expect(response!.json()).resolves.toEqual(document)
    })

    it('lets earlier routing interceptors capture the response', async () => {
      const handler = new OpenRPCHandler(router, {
        routingInterceptors: [
          async ({ next }) => {
            const result = await next()

            return result.matched
              ? { ...result, response: { ...result.response, headers: { ...result.response.headers, 'cache-control': 'max-age=60' } } }
              : result
          },
        ],
        plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec: document })],
      })

      const { response } = await handler.handle(new Request('https://example.com/openrpc.json'))

      expect(response!.headers.get('cache-control')).toBe('max-age=60')
      await expect(response!.json()).resolves.toEqual(document)
    })

    it('returns the inner result when something else matched', async () => {
      const spec = vi.fn(() => document)
      const plugin = new OpenRPCDiscoveryHandlerPlugin({ spec })
      const interceptor = plugin.init({}).routingInterceptors!.at(-1)!
      const nextResult = { matched: true as const, response: { status: 200, headers: {}, body: 'handled' } }
      const next = vi.fn(async () => nextResult)

      const result = await interceptor({
        next,
        context: {},
        prefix: undefined,
        request: { method: 'GET', url: '/openrpc.json', headers: {}, signal: undefined, resolveBody: vi.fn() },
      })

      expect(next).toHaveBeenCalledOnce()
      expect(result).toBe(nextResult)
      expect(spec).not.toHaveBeenCalled()
    })

    it('never serves the document to a JSON-RPC call', async () => {
      const spec = vi.fn(() => document)
      const plugin = new OpenRPCDiscoveryHandlerPlugin({ spec, specPath: '/ping' })
      const interceptor = plugin.init({}).routingInterceptors!.at(-1)!
      const next = vi.fn(async () => ({ matched: false as const }))
      const request: JsonRpcCallRequest = {
        method: 'GET',
        url: '/ping',
        headers: {},
        signal: undefined,
        resolveBody: vi.fn(),
        [JSON_RPC_CALL_SYMBOL]: { method: 'ping', id: 1, notification: false, batch: false },
      }

      await expect(interceptor({ next, context: {}, prefix: undefined, request })).resolves.toEqual({ matched: false })
      expect(next).toHaveBeenCalledOnce()
      expect(spec).not.toHaveBeenCalled()
    })
  })

  describe('other handlers', () => {
    it('serves the document over GET on RPCHandler, but leaves POST requests to the procedures', async () => {
      const spec = vi.fn(() => document)
      const handler = new RPCHandler(router, {
        plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec })],
      })

      const { response } = await handler.handle(new Request('https://example.com/rpc/openrpc.json'), { prefix: '/rpc' })

      expect(response!.status).toBe(200)
      await expect(response!.json()).resolves.toEqual(document)

      // RPCHandler routes by URL: "/rpc/rpc/discover" is the user procedure, not the JSON-RPC method
      const call = await handler.handle(new Request('https://example.com/rpc/rpc/discover', { method: 'POST' }), { prefix: '/rpc' })

      expect(call.matched).toBe(true)
      await expect(call.response!.json()).resolves.toEqual({ json: 'user discover' })
      expect(userDiscover).toHaveBeenCalledOnce()

      const envelope = await handler.handle(createRpcRequest({ jsonrpc: '2.0', method: 'rpc.discover', id: 1 }), { prefix: '/rpc' })

      expect(envelope).toEqual({ matched: false })
      expect(spec).toHaveBeenCalledOnce()
    })

    it('serves the document over GET on OpenAPIHandler, after the procedures', async () => {
      const handler = new OpenAPIHandler({
        ...router,
        openrpc: os.meta(openapi({ method: 'GET', path: '/openrpc.json' })).handler(() => 'procedure'),
      }, {
        plugins: [
          new OpenRPCDiscoveryHandlerPlugin({ spec: document }),
          new OpenRPCDiscoveryHandlerPlugin({ spec: { ...document, info: { title: 'Other', version: '1.0.0' } }, specPath: '/other.json' }),
        ],
      })

      const procedure = await handler.handle(new Request('https://example.com/api/openrpc.json'), { prefix: '/api' })

      await expect(procedure.response!.json()).resolves.toBe('procedure')

      const other = await handler.handle(new Request('https://example.com/api/other.json'), { prefix: '/api' })

      await expect(other.response!.json()).resolves.toEqual({ ...document, info: { title: 'Other', version: '1.0.0' } })
    })
  })

  describe('tracing', () => {
    interface MockSpan extends TracingSpan {
      initialName: string
      name: string
      attributes: Record<string, TracingAttributeValue>
    }

    function useMockTracer(): MockSpan[] {
      const spans: MockSpan[] = []
      const storage = new AsyncLocalStorage<MockSpan>()

      function createSpan(name: string): MockSpan {
        const span: MockSpan = {
          initialName: name,
          name,
          attributes: {},
          setAttribute(key, value) {
            span.attributes[key] = value
          },
          updateName(name) {
            span.name = name
          },
          addEvent() {},
          recordException() {},
          end() {},
        }

        spans.push(span)
        return span
      }

      const tracer: Tracer = {
        startSpan: name => createSpan(name),
        startActiveSpan: (name, _parent, fn) => {
          const span = createSpan(name)
          return storage.run(span, () => fn(span))
        },
        getActiveSpan: () => storage.getStore(),
        withActiveSpan: (span, fn) => storage.run(span as MockSpan, fn),
      }

      const previous = getTracer()
      setTracer(tracer)
      onTestFinished(() => {
        setTracer(previous)
      })

      return spans
    }

    it('names the rpc.discover span after the method', async () => {
      const spans = useMockTracer()
      const handler = new OpenRPCHandler(router, {
        plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec: document })],
      })

      await handler.handle(createRpcRequest([
        { jsonrpc: '2.0', method: 'rpc.discover', id: 1 },
        { jsonrpc: '2.0', method: 'ping', id: 2 },
      ]), { prefix: '/rpc' })

      expect(spans.map(span => ({ initialName: span.initialName, name: span.name, attributes: span.attributes }))).toEqual(expect.arrayContaining([
        { initialName: 'POST /rpc/rpc/discover', name: 'rpc.discover', attributes: { 'rpc.system': 'orpc', 'rpc.method': 'rpc.discover' } },
        { initialName: 'POST /rpc/ping', name: 'orpc.ping', attributes: { 'rpc.system': 'orpc', 'rpc.method': 'ping' } },
      ]))
    })

    it('names the GET span after the configured path', async () => {
      const spans = useMockTracer()
      const handler = new OpenRPCHandler(router, {
        plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec: document })],
      })

      await handler.handle(new Request('https://example.com/rpc/openrpc.json/?v=1'), { prefix: '/rpc' })

      expect(spans[0]).toMatchObject({ initialName: 'GET /rpc/openrpc.json/', name: 'GET /rpc/openrpc.json (openrpc spec)' })
    })
  })
})
