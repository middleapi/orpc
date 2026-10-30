import type { ResponseHeadersHandlerPluginContext } from '@orpc/server/plugins'
import type { StandardHandlerPlugin } from '@orpc/server/standard'
import type { OpenRPCHandlerOptions } from '../fetch'
import { ORPCError } from '@orpc/client'
import { os } from '@orpc/server'
import { CORSHandlerPlugin, RequestLimitHandlerPlugin, ResponseHeadersHandlerPlugin, RethrowHandlerPlugin } from '@orpc/server/plugins'
import { getTracer, promiseWithResolvers, setTracer } from '@orpc/shared'
import { z } from 'zod'
import { OpenRPCHandler } from '../fetch'
import { getJsonRpcCall, JSON_RPC_CALL_SYMBOL } from './utils'

beforeEach(() => {
  vi.clearAllMocks()
})

const notify = vi.fn()

const router = {
  subtract: os
    .input(z.union([z.tuple([z.number(), z.number()]), z.object({ minuend: z.number(), subtrahend: z.number() })]))
    .handler(({ input }) => Array.isArray(input) ? input[0] - input[1] : input.minuend - input.subtrahend),
  sum: os.input(z.array(z.number())).handler(({ input }) => input.reduce((a, b) => a + b, 0)),
  update: os.input(z.array(z.number())).handler(({ input }) => notify('update', input)),
  notify_sum: os.input(z.array(z.number())).handler(({ input }) => notify('notify_sum', input)),
  notify_hello: os.input(z.number()).handler(({ input }) => notify('notify_hello', input)),
  get_data: os.handler(() => ['hello', 5]),
  planet: {
    list: os.input(z.object({ limit: z.number().optional() })).handler(({ input }) => input),
    find: os
      .errors({ NOT_FOUND: { message: 'Planet not found', data: z.object({ id: z.number() }) } })
      .input(z.object({ id: z.number() }))
      .handler(({ input, errors }) => {
        throw errors.NOT_FOUND({ data: { id: input.id } })
      }),
    fail: os.handler(() => {
      throw new Error('secret')
    }),
  },
}

function createHandler(options: OpenRPCHandlerOptions<any> = {}) {
  return new OpenRPCHandler(router, options)
}

function createRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://example.com/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function post(handler: OpenRPCHandler<any>, body: unknown, options: { headers?: Record<string, string>, context?: object } = {}) {
  const { response } = await handler.handle(createRequest(body, options.headers), { prefix: '/rpc', context: options.context ?? {} })
  const text = await response!.text()

  return { status: response!.status, json: text ? JSON.parse(text) : undefined }
}

function batchOf(size: number) {
  return Array.from({ length: size }, (_, id) => ({ jsonrpc: '2.0', method: 'notify_hello', params: [id], id }))
}

describe('standardOpenRPCHandler', () => {
  // https://www.jsonrpc.org/specification#examples
  // positional params are wrapped in one array, since a procedure takes a single input
  it.each([
    ['rpc call with positional parameters', { jsonrpc: '2.0', method: 'subtract', params: [[42, 23]], id: 1 }, { jsonrpc: '2.0', result: 19, id: 1 }],
    ['rpc call with named parameters', { jsonrpc: '2.0', method: 'subtract', params: { subtrahend: 23, minuend: 42 }, id: 3 }, { jsonrpc: '2.0', result: 19, id: 3 }],
    ['rpc call of non-existent method', { jsonrpc: '2.0', method: 'foobar', id: '1' }, { jsonrpc: '2.0', error: { code: -32601, message: 'Method not found' }, id: '1' }],
    ['rpc call with invalid JSON', '{"jsonrpc": "2.0", "method": "foobar, "params": "bar", "baz]', { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }],
    ['rpc call with invalid Request object', { jsonrpc: '2.0', method: 1, params: 'bar' }, { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null }],
    ['rpc call Batch, invalid JSON', '[\n  {"jsonrpc": "2.0", "method": "sum", "params": [1,2,4], "id": "1"},\n  {"jsonrpc": "2.0", "method"\n]', { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }],
    ['rpc call with an empty Array', [], { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null }],
    ['rpc call with an invalid Batch (but not empty)', [1], [{ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null }]],
    ['rpc call with invalid Batch', [1, 2, 3], Array.from({ length: 3 }, () => ({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null }))],
    ['rpc call Batch', [
      { jsonrpc: '2.0', method: 'sum', params: [[1, 2, 4]], id: '1' },
      { jsonrpc: '2.0', method: 'notify_hello', params: [7] },
      { jsonrpc: '2.0', method: 'subtract', params: [[42, 23]], id: '2' },
      { foo: 'boo' },
      { jsonrpc: '2.0', method: 'foo.get', params: { name: 'myself' }, id: '5' },
      { jsonrpc: '2.0', method: 'get_data', id: '9' },
    ], [
      { jsonrpc: '2.0', result: 7, id: '1' },
      { jsonrpc: '2.0', result: 19, id: '2' },
      { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null },
      { jsonrpc: '2.0', error: { code: -32601, message: 'Method not found' }, id: '5' },
      { jsonrpc: '2.0', result: ['hello', 5], id: '9' },
    ]],
  ])('answers the specification example: %s', async (_, request, response) => {
    await expect(post(createHandler(), request)).resolves.toEqual({ status: 200, json: response })
  })

  describe('notifications', () => {
    it('runs notifications to completion and answers a request of only notifications with 204', async () => {
      const handler = createHandler()

      await expect(post(handler, { jsonrpc: '2.0', method: 'update', params: [[1, 2, 3, 4, 5]] })).resolves.toEqual({ status: 204, json: undefined })
      await expect(post(handler, [
        { jsonrpc: '2.0', method: 'notify_sum', params: [[1, 2, 4]] },
        { jsonrpc: '2.0', method: 'notify_hello', params: [7] },
      ])).resolves.toEqual({ status: 204, json: undefined })

      expect(notify.mock.calls).toEqual([['update', [1, 2, 3, 4, 5]], ['notify_sum', [1, 2, 4]], ['notify_hello', 7]])
    })

    it('never answers the errors of notifications', async () => {
      const handler = createHandler()

      await expect(post(handler, { jsonrpc: '2.0', method: 'foobar' })).resolves.toEqual({ status: 204, json: undefined })
      await expect(post(handler, { jsonrpc: '2.0', method: 'planet.fail' })).resolves.toEqual({ status: 204, json: undefined })
      await expect(post(handler, { jsonrpc: '2.0', method: 'planet.find', params: { id: 'x' } })).resolves.toEqual({ status: 204, json: undefined })
    })

    it.each([0, '', null])('answers a call with the falsy id %j, which is not a notification', async (id) => {
      await expect(post(createHandler(), { jsonrpc: '2.0', method: 'get_data', id })).resolves.toEqual({
        status: 200,
        json: { jsonrpc: '2.0', id, result: ['hello', 5] },
      })
    })
  })

  describe('calls', () => {
    it('answers procedure errors with HTTP 200 and the encoded oRPC error', async () => {
      const handler = createHandler()

      await expect(post(handler, { jsonrpc: '2.0', method: 'planet.find', params: { id: 2 }, id: 1 })).resolves.toEqual({
        status: 200,
        json: { jsonrpc: '2.0', id: 1, error: { code: -32004, message: 'Planet not found', data: { code: 'NOT_FOUND', defined: true, data: { id: 2 } } } },
      })

      expect((await post(handler, { jsonrpc: '2.0', method: 'planet.find', params: { id: 'x' }, id: 1 })).json).toMatchObject({
        error: { code: -32602, message: 'Input validation failed', data: { code: 'BAD_REQUEST', defined: false, data: { issues: expect.any(Array) } } },
      })

      expect((await post(handler, { jsonrpc: '2.0', method: 'planet.fail', id: 1 })).json).toEqual({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32603, message: 'Internal Server Error', data: { code: 'INTERNAL_SERVER_ERROR', defined: false } },
      })
    })

    it('treats null params as absent', async () => {
      expect((await post(createHandler(), { jsonrpc: '2.0', method: 'planet.list', params: null, id: 1 })).json).toEqual({ jsonrpc: '2.0', id: 1, result: {} })
    })

    it.each([
      ['an unsupported jsonrpc version', { jsonrpc: '1.0', method: 'get_data', id: 'a' }, 'a'],
      ['no method', { jsonrpc: '2.0', id: 1 }, 1],
      ['params that are neither an array nor an object', { jsonrpc: '2.0', method: 'get_data', params: 'bar', id: 1 }, 1],
      ['an invalid id', { jsonrpc: '2.0', method: 'get_data', id: {} }, null],
      ['a non-object body', null, null],
    ])('answers a request with %s with -32600, echoing its id when valid', async (_, request, id) => {
      expect((await post(createHandler(), request)).json).toEqual({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } })
    })

    it.each([
      ['a body that is not a JSON-RPC result or error', 'replaced'],
      ['both a result and an error', { result: 1, error: { code: 1, message: 'x' } }],
      ['an invalid error object', { error: { code: 1.5, message: 'x' } }],
    ])('answers -32603 when an interceptor replaces the response with %s', async (_, body) => {
      const handler = createHandler({ interceptors: [async () => ({ status: 200, headers: {}, body })] })

      expect((await post(handler, { jsonrpc: '2.0', method: 'get_data', id: 1 })).json).toEqual({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32603, message: 'Internal error' },
      })
    })
  })

  describe('batches', () => {
    it('runs the calls of a batch concurrently and answers them in the request order', async () => {
      const { promise, resolve } = promiseWithResolvers<void>()
      const handler = new OpenRPCHandler({
        slow: os.handler(async () => {
          await promise
          return 'slow'
        }),
        fast: os.handler(() => {
          resolve()
          return 'fast'
        }),
      })

      expect((await post(handler, [{ jsonrpc: '2.0', method: 'slow', id: 1 }, { jsonrpc: '2.0', method: 'fast', id: 2 }])).json).toEqual([
        { jsonrpc: '2.0', id: 1, result: 'slow' },
        { jsonrpc: '2.0', id: 2, result: 'fast' },
      ])
    })

    it('rejects a batch larger than maxBatchSize (default 100) with 413, without running its calls', async () => {
      await expect(post(createHandler(), batchOf(101))).resolves.toEqual({
        status: 413,
        json: {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32013, message: 'Batch size exceeds the maximum of 100.', data: { code: 'PAYLOAD_TOO_LARGE', defined: false } },
        },
      })
      await expect(post(createHandler({ maxBatchSize: 1 }), batchOf(2))).resolves.toMatchObject({ status: 413 })
      expect(notify).not.toHaveBeenCalled()

      await expect(post(createHandler(), batchOf(100))).resolves.toMatchObject({ status: 200 })
    })

    it('passes the HTTP request signal to every call of a batch, notifications included', async () => {
      const signals: (AbortSignal | undefined)[] = []
      const handler = createHandler({
        interceptors: [({ request, next }) => {
          signals.push(request.signal)
          return next()
        }],
      })

      const controller = new AbortController()
      const batch = [{ jsonrpc: '2.0', method: 'get_data', id: 1 }, { jsonrpc: '2.0', method: 'notify_hello', params: [1] }]
      await handler.handle(new Request(createRequest(batch), { signal: controller.signal }), { prefix: '/rpc' })

      expect(signals.map(signal => signal?.aborted)).toEqual([false, false])
      controller.abort()
      expect(signals.map(signal => signal?.aborted)).toEqual([true, true])
    })

    it('resolves a maxBatchSize function per request', async () => {
      const maxBatchSize = vi.fn(({ context }) => context.maxBatchSize)
      const handler = createHandler({ maxBatchSize })

      await expect(post(handler, batchOf(2), { context: { maxBatchSize: 2 } })).resolves.toMatchObject({ status: 200 })
      await expect(post(handler, batchOf(2), { context: { maxBatchSize: 1 } })).resolves.toMatchObject({ status: 413 })
      expect(maxBatchSize).toHaveBeenCalledWith(expect.objectContaining({ prefix: '/rpc', request: expect.objectContaining({ url: '/rpc' }) }))
    })
  })

  describe('the HTTP request', () => {
    it('rejects the whole request with 415 when its content type is not JSON', async () => {
      await expect(post(createHandler(), batchOf(1), { headers: { 'content-type': 'text/plain' } })).resolves.toEqual({
        status: 415,
        json: {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32015, message: 'JSON-RPC requests must use Content-Type: application/json', data: { code: 'UNSUPPORTED_MEDIA_TYPE', defined: false } },
        },
      })
      expect(notify).not.toHaveBeenCalled()
    })

    it('parses the body as JSON for every JSON-RPC media type', async () => {
      await expect(post(createHandler(), { jsonrpc: '2.0', method: 'get_data', id: 1 }, { headers: { 'content-type': 'application/json-rpc' } }))
        .resolves
        .toEqual({ status: 200, json: { jsonrpc: '2.0', id: 1, result: ['hello', 5] } })
    })

    it('passes through requests that are not a POST to the prefix', async () => {
      const handler = createHandler()

      const get = await handler.handle(new Request('https://example.com/rpc'), { prefix: '/rpc' })
      const nested = await handler.handle(new Request('https://example.com/rpc/notify_hello', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notify_hello', params: [1], id: 1 }),
      }), { prefix: '/rpc' })

      expect(get.matched).toBe(false)
      expect(nested.matched).toBe(false)
      expect(notify).not.toHaveBeenCalled()
    })

    it('answers POST requests to any path without a prefix', async () => {
      const { matched, response } = await createHandler().handle(new Request('https://example.com/any/path', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'get_data', id: 1 }),
      }))

      expect(matched).toBe(true)
      await expect(response!.json()).resolves.toEqual({ jsonrpc: '2.0', id: 1, result: ['hello', 5] })
    })

    it('reads the calls from the body, even of a request a routing interceptor marks as a call', async () => {
      const handler = createHandler({
        routingInterceptors: [({ next, ...rest }) => next({
          ...rest,
          request: { ...rest.request, [JSON_RPC_CALL_SYMBOL]: { method: 'get_data', id: 1 } } as typeof rest.request,
        })],
      })

      await expect(post(handler, { jsonrpc: '2.0', method: 'planet.list', id: 2 })).resolves.toEqual({ status: 200, json: { jsonrpc: '2.0', id: 2, result: {} } })
    })
  })

  describe('plugins and interceptors', () => {
    it('runs routing interceptors once per request, and the other interceptors once per call', async () => {
      const calls: unknown[] = []
      const plugin: StandardHandlerPlugin<any> = {
        name: 'record',
        init: options => ({
          ...options,
          routingInterceptors: [({ request, next }) => {
            calls.push(['plugin routing', request.url, getJsonRpcCall(request)])
            return next()
          }, ...options.routingInterceptors ?? []],
          interceptors: [({ request, next }) => {
            calls.push(['plugin interceptor', request.url, getJsonRpcCall(request)])
            return next()
          }, ...options.interceptors ?? []],
        }),
      }

      const handler = createHandler({
        plugins: [plugin],
        routingInterceptors: [({ request, next }) => {
          calls.push(['routing', request.url, getJsonRpcCall(request)])
          return next()
        }],
        clientInterceptors: [({ path, next }) => {
          calls.push(['client', path.join('.')])
          return next()
        }],
      })

      await post(handler, [{ jsonrpc: '2.0', method: 'get_data', id: 1 }, { jsonrpc: '2.0', method: 'notify_hello', params: [1] }])

      expect(calls).toEqual([
        ['plugin routing', '/rpc', undefined],
        ['routing', '/rpc', undefined],
        ['plugin interceptor', '/rpc/get_data', { method: 'get_data', id: 1 }],
        ['plugin interceptor', '/rpc/notify_hello', { method: 'notify_hello', id: undefined }],
        ['client', 'get_data'],
        ['client', 'notify_hello'],
      ])
    })

    it('lets routing interceptors answer, or change the context of, the whole request', async () => {
      const handler = new OpenRPCHandler({
        whoami: os.$context<{ user?: string }>().handler(({ context }) => context.user),
      }, {
        routingInterceptors: [async ({ next, ...options }) => options.request.headers.authorization
          ? next({ ...options, context: { ...options.context, user: 'u1' } })
          : { matched: true, response: { status: 401, headers: {}, body: undefined } }],
      })

      await expect(post(handler, [{ jsonrpc: '2.0', method: 'whoami', id: 1 }])).resolves.toEqual({ status: 401, json: undefined })
      await expect(post(handler, [{ jsonrpc: '2.0', method: 'whoami', id: 1 }, { jsonrpc: '2.0', method: 'whoami', id: 2 }], { headers: { authorization: 'Bearer token' } }))
        .resolves
        .toEqual({ status: 200, json: [{ jsonrpc: '2.0', id: 1, result: 'u1' }, { jsonrpc: '2.0', id: 2, result: 'u1' }] })
    })

    it('passes the HTTP request headers to each call, without its content-length', async () => {
      const seen: Record<string, unknown>[] = []
      const handler = createHandler({
        interceptors: [({ request, next }) => {
          seen.push(request.headers)
          return next()
        }],
      })

      const body = JSON.stringify({ jsonrpc: '2.0', method: 'get_data', id: 1 })
      await post(handler, body, { headers: { 'authorization': 'Bearer token', 'content-length': String(body.length) } })

      expect(seen).toEqual([expect.objectContaining({ 'authorization': 'Bearer token', 'content-type': 'application/json' })])
      expect(seen[0]!['content-length']).toBeUndefined()
    })

    it('forwards the response headers of a call, without its body headers', async () => {
      const handler = createHandler({
        interceptors: [async ({ next }) => {
          const response = await next()
          return { ...response, headers: { ...response.headers, 'x-custom': 'value', 'content-disposition': 'attachment' } }
        }],
      })

      const { response } = await handler.handle(createRequest({ jsonrpc: '2.0', method: 'get_data', id: 1 }), { prefix: '/rpc' })

      expect(response!.headers.get('x-custom')).toBe('value')
      expect(response!.headers.get('content-disposition')).toBeNull()
      expect(response!.headers.get('content-type')).toBe('application/json')
    })

    it('merges the response headers of the calls of a batch, including notifications', async () => {
      const handler = createHandler({
        interceptors: [async ({ next, path }) => {
          const response = await next()
          return { ...response, headers: { ...response.headers, 'set-cookie': `${path.join('.')}=1` } }
        }],
      })

      const { response } = await handler.handle(createRequest([
        { jsonrpc: '2.0', method: 'get_data', id: 1 },
        { jsonrpc: '2.0', method: 'notify_hello', params: [1] },
      ]), { prefix: '/rpc' })

      expect(response!.headers.getSetCookie()).toEqual(['get_data=1', 'notify_hello=1'])
    })

    it('keeps CORS, request limit and response headers plugins on the HTTP request', async () => {
      const handler = new OpenRPCHandler({
        login: os.$context<ResponseHeadersHandlerPluginContext>().handler(({ context }) => {
          context.resHeaders?.set('cache-control', 'no-store')
        }),
      }, {
        plugins: [new CORSHandlerPlugin(), new ResponseHeadersHandlerPlugin(), new RequestLimitHandlerPlugin({ maxBodySize: 200 })],
      })

      const { response } = await handler.handle(createRequest([{ jsonrpc: '2.0', method: 'login', id: 1 }], { origin: 'https://example.com' }), { prefix: '/rpc', context: {} })

      expect(response!.headers.get('access-control-allow-origin')).toBe('*')
      expect(response!.headers.get('cache-control')).toBe('no-store')

      await expect(post(handler, batchOf(5))).resolves.toMatchObject({
        status: 413,
        json: { id: null, error: { code: -32013, data: { code: 'PAYLOAD_TOO_LARGE' } } },
      })
    })

    it('opens one tracing span per call of a batch', async ({ onTestFinished }) => {
      const tracer = getTracer()
      onTestFinished(() => setTracer(tracer))

      const names: string[] = []
      const span = { setAttribute: vi.fn(), updateName: vi.fn(), addEvent: vi.fn(), recordException: vi.fn(), end: vi.fn() }
      setTracer({
        startSpan: () => span,
        startActiveSpan: (name, _parent, fn) => {
          names.push(name)
          return fn(span)
        },
        getActiveSpan: () => span,
        withActiveSpan: (_span, fn) => fn(),
      })

      await post(createHandler(), [{ jsonrpc: '2.0', method: 'get_data', id: 1 }, { jsonrpc: '2.0', method: 'notify_hello', params: [1] }])

      expect(names.filter(name => name.startsWith('POST'))).toEqual(['POST /rpc/get_data', 'POST /rpc/notify_hello'])
    })

    it('rethrows the errors the rethrow plugin catches, once every call of the request has run', async () => {
      const handled = vi.fn()
      const handler = new OpenRPCHandler({
        ...router,
        get_data: os.handler(handled),
      }, { plugins: [new RethrowHandlerPlugin({ filter: error => !(error instanceof ORPCError) })] })

      await expect(post(handler, { jsonrpc: '2.0', method: 'planet.fail', id: 1 })).rejects.toThrow('secret')
      await expect(post(handler, [{ jsonrpc: '2.0', method: 'planet.fail', id: 1 }, { jsonrpc: '2.0', method: 'get_data', id: 2 }])).rejects.toThrow('secret')
      expect(handled).toHaveBeenCalledOnce()
    })

    it('rethrows unexpected errors of a single call, but answers the other calls of a batch with -32603', async ({ onTestFinished }) => {
      const rejectSpy = vi.spyOn(Promise, 'reject').mockImplementation(() => new Promise(() => {}) as Promise<never>)

      onTestFinished(() => {
        rejectSpy.mockRestore()
      })

      // a lazy router that fails to load fails the call outside of the interceptors
      const handler = new OpenRPCHandler({
        ...router,
        broken: os.lazy(async () => {
          throw new Error('secret')
        }),
      })

      await expect(post(handler, { jsonrpc: '2.0', method: 'broken.ping', id: 1 })).rejects.toThrow('secret')
      expect(rejectSpy).not.toHaveBeenCalled()

      expect((await post(handler, [{ jsonrpc: '2.0', method: 'broken.ping', id: 1 }, { jsonrpc: '2.0', method: 'get_data', id: 2 }])).json).toEqual([
        { jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Internal error' } },
        { jsonrpc: '2.0', id: 2, result: ['hello', 5] },
      ])
      expect(rejectSpy).toHaveBeenCalledOnce()
      expect(rejectSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'secret' }))
    })
  })
})
