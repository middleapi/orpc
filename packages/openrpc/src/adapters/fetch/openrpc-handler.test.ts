import type { StandardHandlerPlugin } from '@orpc/server/standard'
import { ORPCError } from '@orpc/client'
import { eventIterator } from '@orpc/contract'
import { os } from '@orpc/server'
import { CORSHandlerPlugin, RequestLimitHandlerPlugin, RethrowHandlerPlugin } from '@orpc/server/plugins'
import { z } from 'zod'
import { getJsonRpcCall } from '../standard'
import { OpenRPCHandler } from './openrpc-handler'

const notify = vi.fn()

const router = {
  subtract: os
    .input(z.union([z.tuple([z.number(), z.number()]), z.object({ minuend: z.number(), subtrahend: z.number() })]))
    .handler(({ input }) => Array.isArray(input) ? input[0] - input[1] : input.minuend - input.subtrahend),
  sum: os.input(z.array(z.number())).handler(({ input }) => input.reduce((a, b) => a + b, 0)),
  notify: os.input(z.any()).handler(({ input }) => notify(input)),
  get_data: os.handler(() => ['hello', 5]),
  planet: {
    list: os.input(z.object({ limit: z.number().optional() })).handler(({ input }) => input),
    find: os
      .errors({ NOT_FOUND: { message: 'Planet not found', data: z.object({ id: z.number() }) } })
      .input(z.object({ id: z.number() }))
      .handler(({ input, errors }) => {
        if (input.id !== 1) {
          throw errors.NOT_FOUND({ data: { id: input.id } })
        }

        return { id: 1, discoveredAt: new Date(0) }
      }),
    void: os.input(z.void()).handler(() => undefined),
    stream: os.handler(() => new ReadableStream()),
    events: os.output(eventIterator(z.string())).handler(async function* () {}),
    fail: os.handler(() => {
      throw new Error('secret')
    }),
  },
}

async function post(handler: OpenRPCHandler<any>, body: unknown, init: RequestInit = {}) {
  const { matched, response } = await handler.handle(new Request('http://localhost/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  }), { prefix: '/rpc' })

  return { matched, status: response?.status, headers: response?.headers, json: await response?.json().catch(() => undefined) }
}

describe('openRPCHandler', () => {
  const handler = new OpenRPCHandler(router)

  beforeEach(() => {
    notify.mockClear()
  })

  // https://www.jsonrpc.org/specification#examples
  it.each([
    [{ jsonrpc: '2.0', method: 'subtract', params: [[42, 23]], id: 1 }, { jsonrpc: '2.0', result: 19, id: 1 }],
    [{ jsonrpc: '2.0', method: 'subtract', params: { subtrahend: 23, minuend: 42 }, id: 3 }, { jsonrpc: '2.0', result: 19, id: 3 }],
    [{ jsonrpc: '2.0', method: 'foobar', id: '1' }, { jsonrpc: '2.0', error: { code: -32601, message: 'Method not found' }, id: '1' }],
    ['{"jsonrpc": "2.0", "method": "foobar, "params": "bar", "baz]', { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }],
    [{ jsonrpc: '2.0', method: 1, params: 'bar' }, { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null }],
    [[], { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null }],
    [[1], [{ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null }]],
    [[
      { jsonrpc: '2.0', method: 'sum', params: [[1, 2, 4]], id: '1' },
      { jsonrpc: '2.0', method: 'notify', params: [7] },
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
  ])('answers specification example %#', async (request, response) => {
    await expect(post(handler, request)).resolves.toMatchObject({ status: 200, json: response })
  })

  it('runs notifications without answering them', async () => {
    await expect(post(handler, { jsonrpc: '2.0', method: 'notify', params: [1] })).resolves.toMatchObject({ status: 204, json: undefined })
    await expect(post(handler, [{ jsonrpc: '2.0', method: 'notify', params: [2] }, { jsonrpc: '2.0', method: 'foobar' }]))
      .resolves
      .toMatchObject({ status: 204, json: undefined })
    expect(notify.mock.calls).toEqual([[1], [2]])
  })

  it('encodes typesafe errors, validation errors and unknown errors', async () => {
    expect((await post(handler, { jsonrpc: '2.0', method: 'planet.find', params: { id: 2 }, id: 1 })).json).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32004, message: 'Planet not found', data: { code: 'NOT_FOUND', defined: true, data: { id: 2 } } },
    })
    expect((await post(handler, { jsonrpc: '2.0', method: 'planet.find', params: { id: 'x' }, id: 1 })).json).toMatchObject({
      error: { code: -32602, message: 'Input validation failed', data: { code: 'BAD_REQUEST', defined: false, data: { issues: expect.any(Array) } } },
    })
    expect((await post(handler, { jsonrpc: '2.0', method: 'planet.fail', id: 1 })).json).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32603, message: 'Internal Server Error', data: { code: 'INTERNAL_SERVER_ERROR', defined: false } },
    })
    expect((await post(handler, { jsonrpc: '2.0', method: 'subtract', params: [1, 2], id: 1 })).json).toMatchObject({
      error: { code: -32602, message: 'Invalid params: expected at most 1 positional parameter, received 2.' },
    })
  })

  it('serializes results like OpenAPI responses', async () => {
    expect((await post(handler, { jsonrpc: '2.0', method: 'planet.find', params: { id: 1 }, id: 1 })).json)
      .toEqual({ jsonrpc: '2.0', id: 1, result: { id: 1, discoveredAt: '1970-01-01T00:00:00.000Z' } })
    expect((await post(handler, { jsonrpc: '2.0', method: 'planet.void', id: 1 })).json)
      .toEqual({ jsonrpc: '2.0', id: 1, result: null })
    expect((await post(handler, { jsonrpc: '2.0', method: 'planet.stream', id: 1 })).json)
      .toMatchObject({ error: { code: -32603 } })
  })

  it.each([undefined, null, [], {}])('resolves empty params %j to the empty input the procedure accepts', async (params) => {
    expect((await post(handler, { jsonrpc: '2.0', method: 'planet.list', params, id: 1 })).json).toMatchObject({ result: {} })
    expect((await post(handler, { jsonrpc: '2.0', method: 'planet.void', params, id: 1 })).json).toMatchObject({ result: null })
  })

  it.each(['rpc.discover', 'planet.events', 'planet', 'planet.', '.planet.list', 'planet..list', 'toString'])('does not find the method %s', async (method) => {
    expect((await post(handler, { jsonrpc: '2.0', method, id: 1 })).json).toMatchObject({ error: { code: -32601 } })
  })

  it('echoes valid ids of invalid requests', async () => {
    expect((await post(handler, { jsonrpc: '1.0', method: 'sum', id: 'a' })).json).toMatchObject({ id: 'a', error: { code: -32600 } })
    expect((await post(handler, { jsonrpc: '2.0', method: 'sum', id: {} })).json).toMatchObject({ id: null, error: { code: -32600 } })
  })

  it('rejects the whole request for a wrong content type or a too large batch', async () => {
    expect(await post(handler, { jsonrpc: '2.0', method: 'get_data', id: 1 }, { headers: { 'content-type': 'text/plain' } }))
      .toMatchObject({ status: 415, json: { id: null, error: { code: -32015, data: { code: 'UNSUPPORTED_MEDIA_TYPE' } } } })

    const small = new OpenRPCHandler(router, { maxBatchSize: 1 })
    expect(await post(small, [{ jsonrpc: '2.0', method: 'get_data', id: 1 }, { jsonrpc: '2.0', method: 'get_data', id: 2 }]))
      .toMatchObject({ status: 413, json: { id: null, error: { code: -32013 } } })
  })

  it('passes through other methods and paths', async () => {
    const { matched } = await handler.handle(new Request('http://localhost/rpc'), { prefix: '/rpc' })
    expect(matched).toBe(false)
    expect((await handler.handle(new Request('http://localhost/rpc/sum', { method: 'POST' }), { prefix: '/rpc' })).matched).toBe(false)
  })

  it('uses a custom error code map', async () => {
    const custom = new OpenRPCHandler(router, { errorCodeMap: { NOT_FOUND: 404 } })
    expect((await post(custom, { jsonrpc: '2.0', method: 'planet.find', params: { id: 2 }, id: 1 })).json).toMatchObject({ error: { code: 404 } })
    expect((await post(custom, { jsonrpc: '2.0', method: 'planet.fail', id: 1 })).json).toMatchObject({ error: { code: -32000 } })
  })

  it('runs plugins inside the envelope once per call, and outside it once per request', async () => {
    const calls: unknown[] = []
    const plugin = (name: string, order: Pick<StandardHandlerPlugin<any>, 'before' | 'after'>): StandardHandlerPlugin<any> => ({
      name,
      ...order,
      init: options => ({
        ...options,
        routingInterceptors: [({ request, next }) => {
          calls.push([name, request.url, getJsonRpcCall(request)])
          return next()
        }, ...options.routingInterceptors ?? []],
      }),
    })

    const handler = new OpenRPCHandler(router, { plugins: [plugin('outer', { after: ['~openrpc'] }), plugin('inner', { before: ['~openrpc'] })] })
    await post(handler, [{ jsonrpc: '2.0', method: 'get_data', id: 1 }, { jsonrpc: '2.0', method: 'notify', params: [1] }])

    expect(calls).toEqual([
      ['outer', '/rpc', undefined],
      ['inner', '/rpc/get_data', { method: 'get_data', id: 1 }],
      ['inner', '/rpc/notify', { method: 'notify', id: undefined }],
    ])
  })

  it('keeps CORS and body limit plugins on the HTTP request', async () => {
    const handler = new OpenRPCHandler(router, { plugins: [new CORSHandlerPlugin(), new RequestLimitHandlerPlugin({ maxBodySize: 10 })] })

    expect(await post(handler, { jsonrpc: '2.0', method: 'get_data', id: 1 }, { headers: { 'content-type': 'application/json', 'origin': 'http://a.com' } }))
      .toMatchObject({ status: 413, json: { id: null, error: { code: -32013 } } })
  })

  it('merges the headers of batch calls', async () => {
    const handler = new OpenRPCHandler({
      a: os.handler(() => 1),
      b: os.handler(() => 2),
    }, {
      interceptors: [async ({ next, path }) => {
        const response = await next()
        return { ...response, headers: { ...response.headers, 'set-cookie': `${path[0]}=1` } }
      }],
    })

    const { headers } = await post(handler, [{ jsonrpc: '2.0', method: 'a', id: 1 }, { jsonrpc: '2.0', method: 'b', id: 2 }])
    expect(headers?.getSetCookie()).toEqual(['a=1', 'b=1'])
  })

  it('rethrows errors of a single call, but answers the other calls of a batch', async () => {
    const reject = vi.spyOn(Promise, 'reject').mockImplementation(() => undefined as any)
    const handler = new OpenRPCHandler(router, { plugins: [new RethrowHandlerPlugin({ filter: error => !(error instanceof ORPCError) })] })

    try {
      await expect(post(handler, { jsonrpc: '2.0', method: 'planet.fail', id: 1 })).rejects.toThrow('secret')
      expect((await post(handler, [{ jsonrpc: '2.0', method: 'planet.fail', id: 1 }, { jsonrpc: '2.0', method: 'get_data', id: 2 }])).json).toEqual([
        { jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Internal error' } },
        { jsonrpc: '2.0', id: 2, result: ['hello', 5] },
      ])
      expect(reject).toHaveBeenCalledWith(expect.objectContaining({ message: 'secret' }))
    }
    finally {
      reject.mockRestore()
    }
  })
})
