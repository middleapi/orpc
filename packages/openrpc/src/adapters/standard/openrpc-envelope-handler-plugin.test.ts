import type { StandardHandlerOptions, StandardHandlerPlugin } from '@orpc/server/standard'
import type { Tracer, TracingSpan } from '@orpc/shared'
import type { StandardHeaders, StandardLazyRequest } from '@standard-server/core'
import type { OpenRPCEnvelopeHandlerPluginOptions } from './openrpc-envelope-handler-plugin'
import type { OpenRPCHandlerCodecOptions } from './openrpc-handler-codec'
import { AsyncLocalStorage } from 'node:async_hooks'
import { ORPCError } from '@orpc/client'
import { asyncIteratorObject } from '@orpc/contract'
import { TmpFileUploadHandlerPlugin } from '@orpc/node'
import { PinoHandlerPlugin } from '@orpc/pino'
import { ratelimit, RateLimitHandlerPlugin } from '@orpc/ratelimit'
import { MemoryRateLimiter } from '@orpc/ratelimit/memory'
import { os } from '@orpc/server'
import { FetchHandler } from '@orpc/server/fetch'
import { BatchHandlerPlugin, CORSHandlerPlugin, MethodOverrideHandlerPlugin, RequestCompressionHandlerPlugin, RequestHeadersHandlerPlugin, RequestLimitHandlerPlugin, ResponseCompressionHandlerPlugin, ResponseHeadersHandlerPlugin, RethrowHandlerPlugin, SignalSyncHandlerPlugin } from '@orpc/server/plugins'
import { StandardHandler, TracingHandlerPlugin } from '@orpc/server/standard'
import { getTracer, setTracer, sleep, sortPlugins, toArray } from '@orpc/shared'
import { z } from 'zod'
import { getJsonRpcCall } from './call'
import { OpenRPCEnvelopeHandlerPlugin } from './openrpc-envelope-handler-plugin'
import { OpenRPCHandlerCodec } from './openrpc-handler-codec'

type HandlerOptions = StandardHandlerOptions<any> & OpenRPCHandlerCodecOptions<any> & OpenRPCEnvelopeHandlerPluginOptions<any>

function createHandler(router: any, options: HandlerOptions = {}): StandardHandler<any> {
  return new StandardHandler(new OpenRPCHandlerCodec(router, options), {
    ...options,
    plugins: [...toArray(options.plugins), new OpenRPCEnvelopeHandlerPlugin(options)],
  })
}

function createRequest(body: unknown, overrides: Partial<StandardLazyRequest> = {}) {
  return {
    method: 'POST',
    url: '/' as const,
    headers: { 'content-type': 'application/json' } as StandardHeaders,
    signal: undefined as AbortSignal | undefined,
    resolveBody: vi.fn(async (_hint?: string): Promise<unknown> => body),
    ...overrides,
  }
}

const INVALID_REQUEST = { code: -32600, message: 'Invalid Request' }
const METHOD_NOT_FOUND = { code: -32601, message: 'Method not found' }
const PARSE_ERROR = { code: -32700, message: 'Parse error' }
const INTERNAL_ERROR = { code: -32603, message: 'Internal error' }

const router = {
  ping: os.handler(() => 'pong'),
  echo: os.input(z.any()).handler(({ input }) => input),
  nothing: os.handler(() => undefined),
  planet: {
    find: os.input(z.object({ id: z.number() })).handler(({ input }) => ({ id: input.id, name: 'Earth' })),
  },
  missing: os.handler(() => {
    throw new ORPCError('NOT_FOUND', { message: 'Planet not found', data: { id: 1 } })
  }),
  crash: os.handler(() => {
    throw new Error('secret database error')
  }),
  stream: os.handler(() => new ReadableStream()),
  blob: os.handler(() => new Blob(['x'])),
  iterator: os.output(asyncIteratorObject(z.string())).handler(async function* () {}),
  hidden: os.handler(() => 'hidden'),
  rpc: { discover: os.handler(() => 'user discover') },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('openRPCEnvelopeHandlerPlugin', () => {
  it('has ordering hints that keep body and response plugins outside and tracing inside', () => {
    const plugin = new OpenRPCEnvelopeHandlerPlugin()

    expect(plugin.name).toBe('~openrpc')
    expect(plugin.after).toEqual(['~tracing'])
    expect(plugin.before).toEqual(['~cors', '~request-limit', '~request-compression', '~response-compression', '~response-headers', '~tmp-file-upload'])
  })

  it('rejects error code maps with non-integer values', () => {
    expect(() => new OpenRPCEnvelopeHandlerPlugin({ errorCodeMap: { A: 1.5 } })).toThrow(
      new TypeError('[OpenRPCEnvelopeHandlerPlugin] "errorCodeMap.A" must be an integer JSON-RPC error code, received 1.5.'),
    )
  })

  it('prepends its routing interceptor', () => {
    const existing = vi.fn()
    const options = new OpenRPCEnvelopeHandlerPlugin().init({ routingInterceptors: [existing] })

    expect(options.routingInterceptors).toHaveLength(2)
    expect(options.routingInterceptors![1]).toBe(existing)
  })

  describe.each([
    ['always-200', undefined],
    ['always-200', 'always-200'],
    ['mapped', 'mapped'],
  ] as const)('behaviour matrix (%s)', (mode, errorResponseStatus) => {
    const mapped = mode === 'mapped'
    const handler = createHandler(router, { errorResponseStatus, filter: (_, path) => path[0] !== 'hidden', maxBatchSize: 4 })

    async function handle(body: unknown, overrides: Partial<StandardLazyRequest> = {}) {
      return handler.handle(createRequest(body, overrides), { context: {} })
    }

    it('#1 passes non-POST requests through without reading the body', async () => {
      for (const method of ['GET', 'PUT', 'OPTIONS', 'DELETE']) {
        const request = createRequest({ jsonrpc: '2.0', method: 'ping', id: 1 }, { method, url: '/ping' })

        await expect(handler.handle(request, { context: {} })).resolves.toEqual({ matched: false })
        expect(request.resolveBody).not.toHaveBeenCalled()
      }
    })

    it('#1 lets inner routing interceptors answer passed-through requests', async () => {
      const handler = createHandler(router, {
        errorResponseStatus,
        routingInterceptors: [
          async ({ request, next }) => {
            const result = await next()

            if (!result.matched && request.method === 'GET' && getJsonRpcCall(request) === undefined) {
              return { matched: true, response: { status: 200, headers: {}, body: { openrpc: '1.3.2' } } }
            }

            return result
          },
        ],
      })

      await expect(handler.handle(createRequest(undefined, { method: 'GET', url: '/rpc/openrpc.json' }), { context: {}, prefix: '/rpc' })).resolves.toEqual({
        matched: true,
        response: { status: 200, headers: {}, body: { openrpc: '1.3.2' } },
      })
    })

    it('#1 passes POST requests at another path than the prefix through', async () => {
      for (const url of ['/rpc/ping', '/rpc/planet/find', '/rpc/x/y'] as const) {
        const request = createRequest({ jsonrpc: '2.0', method: 'ping', id: 1 }, { url })

        await expect(handler.handle(request, { context: {}, prefix: '/rpc' })).resolves.toEqual({ matched: false })
        expect(request.resolveBody).not.toHaveBeenCalled()
      }
    })

    it('#1 serves the prefix itself, with an optional trailing slash and query', async () => {
      for (const url of ['/rpc', '/rpc/', '/rpc?x=1'] as const) {
        const { response } = await handler.handle(createRequest({ jsonrpc: '2.0', method: 'ping', id: 1 }, { url }), { context: {}, prefix: '/rpc' })

        expect(response?.body).toEqual({ jsonrpc: '2.0', id: 1, result: 'pong' })
      }
    })

    it('#1 serves any path without a prefix', async () => {
      const { response } = await handle({ jsonrpc: '2.0', method: 'ping', id: 1 }, { url: '/anything/here' })

      expect(response?.body).toEqual({ jsonrpc: '2.0', id: 1, result: 'pong' })
    })

    it.each([
      [undefined],
      ['text/plain'],
      ['multipart/form-data; boundary=x'],
      ['application/x-www-form-urlencoded'],
      ['application/jsonx'],
    ])('#2 rejects content type %s with 415', async (contentType) => {
      const request = createRequest({ jsonrpc: '2.0', method: 'ping', id: 1 }, { headers: { 'content-type': contentType } })

      const { response } = await handler.handle(request, { context: {} })

      expect(response).toEqual({
        status: 415,
        headers: {},
        body: {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32015,
            message: 'JSON-RPC requests must use Content-Type: application/json',
            data: { code: 'UNSUPPORTED_MEDIA_TYPE', defined: false },
          },
        },
      })
      expect(request.resolveBody).not.toHaveBeenCalled()
    })

    it.each([
      ['application/json'],
      ['application/json; charset=utf-8'],
      ['Application/JSON'],
      ['application/json-rpc'],
      ['application/jsonrequest'],
    ])('#2 accepts content type %s', async (contentType) => {
      const { response } = await handle({ jsonrpc: '2.0', method: 'ping', id: 1 }, { headers: { 'content-type': contentType } })

      expect(response).toEqual({ status: 200, headers: {}, body: { jsonrpc: '2.0', id: 1, result: 'pong' } })
    })

    it('#3 rejects an ORPCError thrown while reading the body at its status', async () => {
      const tooLarge = await handle(undefined, { resolveBody: vi.fn().mockRejectedValue(new ORPCError('PAYLOAD_TOO_LARGE')) })

      expect(tooLarge.response).toEqual({
        status: 413,
        headers: {},
        body: {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32013, message: 'Payload Too Large', data: { code: 'PAYLOAD_TOO_LARGE', defined: false } },
        },
      })

      const unsupported = await handle(undefined, {
        resolveBody: vi.fn().mockRejectedValue(new ORPCError('UNSUPPORTED_MEDIA_TYPE', { message: 'Too many content encodings.' })),
      })

      expect(unsupported.response?.status).toBe(415)
      expect(unsupported.response?.body).toMatchObject({ id: null, error: { code: -32015, message: 'Too many content encodings.' } })
    })

    it('#4 answers an unreadable or empty body with "Parse error"', async () => {
      for (const resolveBody of [
        vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
        vi.fn().mockRejectedValue(new TypeError('Failed to decompress')),
        vi.fn().mockResolvedValue(undefined),
      ]) {
        const { response } = await handle(undefined, { resolveBody })

        expect(response).toEqual({
          status: mapped ? 400 : 200,
          headers: {},
          body: { jsonrpc: '2.0', id: null, error: PARSE_ERROR },
        })
      }
    })

    it.each([[1], ['x'], [null], [true], [{}]])('#5 answers a non-request payload %j with "Invalid Request"', async (payload) => {
      const { response } = await handle(payload)

      expect(response).toEqual({
        status: mapped ? 400 : 200,
        headers: {},
        body: { jsonrpc: '2.0', id: null, error: INVALID_REQUEST },
      })
    })

    it('#6 answers an empty batch with a single "Invalid Request" object', async () => {
      const { response } = await handle([])

      expect(response).toEqual({
        status: mapped ? 400 : 200,
        headers: {},
        body: { jsonrpc: '2.0', id: null, error: INVALID_REQUEST },
      })
    })

    it('#7 rejects a batch larger than maxBatchSize with 413', async () => {
      const call = { jsonrpc: '2.0', method: 'ping', id: 1 }

      await expect(handle([call, call, call, call])).resolves.toMatchObject({ response: { status: 200 } })

      const { response } = await handle([call, call, call, call, call])

      expect(response).toEqual({
        status: 413,
        headers: {},
        body: {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32013, message: 'Batch size exceeds the maximum of 4.', data: { code: 'PAYLOAD_TOO_LARGE', defined: false } },
        },
      })
    })

    it.each([
      [{ jsonrpc: '1.0', method: 'ping', id: 1 }, 1],
      [{ method: 'ping', id: 'a' }, 'a'],
      [{ jsonrpc: '2.0', method: 1, id: 2 }, 2],
      [{ jsonrpc: '2.0', id: 3 }, 3],
      [{ jsonrpc: '2.0', method: 'ping', params: 'x', id: 4 }, 4],
      [{ jsonrpc: '2.0', method: 'ping', params: 1, id: 5 }, 5],
      [{ jsonrpc: '2.0', method: 'ping', id: {} }, null],
      [{ jsonrpc: '2.0', method: 'ping', id: true }, null],
      [{ jsonrpc: '2.0', method: 'ping', id: [1] }, null],
      [{ jsonrpc: '1.0', method: 'ping', id: {} }, null],
      [{ jsonrpc: '1.0', method: 'ping' }, null],
    ])('#8 answers an invalid request object %j with "Invalid Request" and id %j', async (payload, id) => {
      const { response } = await handle(payload)

      expect(response).toEqual({
        status: mapped ? 400 : 200,
        headers: {},
        body: { jsonrpc: '2.0', id, error: INVALID_REQUEST },
      })
    })

    it('#9 answers a successful call with its result', async () => {
      await expect(handle({ jsonrpc: '2.0', method: 'planet.find', params: { id: 1 }, id: 1 })).resolves.toEqual({
        matched: true,
        response: { status: 200, headers: {}, body: { jsonrpc: '2.0', id: 1, result: { id: 1, name: 'Earth' } } },
      })

      await expect(handle({ jsonrpc: '2.0', method: 'planet.find', params: [{ id: 2 }], id: 'b' })).resolves.toMatchObject({
        response: { status: 200, body: { jsonrpc: '2.0', id: 'b', result: { id: 2, name: 'Earth' } } },
      })
    })

    it('#9 answers an undefined output with a null result', async () => {
      const { response } = await handle({ jsonrpc: '2.0', method: 'nothing', id: 1 })

      expect(response?.body).toEqual({ jsonrpc: '2.0', id: 1, result: null })
      expect(Object.hasOwn(response?.body as object, 'result')).toBe(true)
    })

    it('#10 answers a procedure error', async () => {
      const { response } = await handle({ jsonrpc: '2.0', method: 'missing', id: 1 })

      expect(response).toEqual({
        status: mapped ? 404 : 200,
        headers: {},
        body: {
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32004, message: 'Planet not found', data: { code: 'NOT_FOUND', defined: false, data: { id: 1 } } },
        },
      })
    })

    it('#10 answers a validation error with "Invalid params"', async () => {
      const { response } = await handle({ jsonrpc: '2.0', method: 'planet.find', params: { id: 'x' }, id: 1 })

      expect(response?.status).toBe(mapped ? 400 : 200)
      expect(response?.body).toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32602, message: 'Input validation failed', data: { code: 'BAD_REQUEST', defined: false, data: { issues: expect.any(Array) } } },
      })
    })

    it('#10 answers more than one positional param with "Invalid params"', async () => {
      const { response } = await handle({ jsonrpc: '2.0', method: 'echo', params: [1, 2], id: 1 })

      expect(response).toEqual({
        status: mapped ? 400 : 200,
        headers: {},
        body: {
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: -32602,
            message: 'Invalid params: expected at most 1 positional parameter, received 2.',
            data: { code: 'BAD_REQUEST', defined: false },
          },
        },
      })
    })

    it('#10 does not leak the message of an unexpected error', async () => {
      const { response } = await handle({ jsonrpc: '2.0', method: 'crash', id: 1 })

      expect(response).toEqual({
        status: mapped ? 500 : 200,
        headers: {},
        body: {
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32603, message: 'Internal Server Error', data: { code: 'INTERNAL_SERVER_ERROR', defined: false } },
        },
      })
    })

    it.each([
      ['unknown'],
      ['planet'],
      ['planet.find.more'],
      ['hidden'],
      ['iterator'],
      ['rpc.discover'],
      ['rpc.ping'],
      [''],
      ['planet..find'],
      ['planet.find.'],
      ['.ping'],
    ])('#11 answers method %j with "Method not found"', async (method) => {
      const { response } = await handle({ jsonrpc: '2.0', method, id: 7 })

      expect(response).toEqual({
        status: mapped ? 404 : 200,
        headers: {},
        body: { jsonrpc: '2.0', id: 7, error: METHOD_NOT_FOUND },
      })
    })

    it.each([['stream'], ['blob']])('#12 answers an unsendable %s output with an internal error', async (method) => {
      const { response } = await handle({ jsonrpc: '2.0', method, id: 1 })

      expect(response).toEqual({
        status: mapped ? 500 : 200,
        headers: {},
        body: {
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32603, message: 'Internal Server Error', data: { code: 'INTERNAL_SERVER_ERROR', defined: false } },
        },
      })
    })

    it.each([
      [{ method: 'ping' }],
      [{ method: 'missing' }],
      [{ method: 'crash' }],
      [{ method: 'unknown' }],
      [{ method: 'rpc.discover' }],
      [{ method: 'stream' }],
      [{ method: 'planet.find', params: { id: 'x' } }],
      [{ method: 'echo', params: [1, 2] }],
    ])('#13 answers a single notification %j with 204 and no body', async (call) => {
      await expect(handle({ jsonrpc: '2.0', ...call })).resolves.toEqual({
        matched: true,
        response: { status: 204, headers: {}, body: undefined },
      })
    })

    it('#14 answers a batch with an array in request order, without notifications', async () => {
      const { response } = await handle([
        { jsonrpc: '2.0', method: 'planet.find', params: { id: 1 }, id: 1 },
        { jsonrpc: '2.0', method: 'ping' },
        { jsonrpc: '2.0', method: 'missing', id: '2' },
        { jsonrpc: '2.0', method: 'unknown', id: null },
      ])

      expect(response).toEqual({
        status: 200,
        headers: {},
        body: [
          { jsonrpc: '2.0', id: 1, result: { id: 1, name: 'Earth' } },
          {
            jsonrpc: '2.0',
            id: '2',
            error: { code: -32004, message: 'Planet not found', data: { code: 'NOT_FOUND', defined: false, data: { id: 1 } } },
          },
          { jsonrpc: '2.0', id: null, error: METHOD_NOT_FOUND },
        ],
      })
    })

    it('#14 answers a batch of one with an array', async () => {
      const { response } = await handle([{ jsonrpc: '2.0', method: 'missing', id: 1 }])

      expect(response?.status).toBe(200)
      expect(response?.body).toEqual([
        { jsonrpc: '2.0', id: 1, error: { code: -32004, message: 'Planet not found', data: { code: 'NOT_FOUND', defined: false, data: { id: 1 } } } },
      ])
    })

    it('#15 answers a batch of only notifications with 204 and no body', async () => {
      await expect(handle([
        { jsonrpc: '2.0', method: 'ping' },
        { jsonrpc: '2.0', method: 'missing' },
        { jsonrpc: '2.0', method: 'unknown' },
      ])).resolves.toEqual({
        matched: true,
        response: { status: 204, headers: {}, body: undefined },
      })
    })

    it('#16 answers invalid batch items in their slot', async () => {
      const { response } = await handle([
        1,
        { foo: 'boo' },
        { jsonrpc: '2.0', method: 'ping', id: 3 },
      ])

      expect(response).toEqual({
        status: 200,
        headers: {},
        body: [
          { jsonrpc: '2.0', id: null, error: INVALID_REQUEST },
          { jsonrpc: '2.0', id: null, error: INVALID_REQUEST },
          { jsonrpc: '2.0', id: 3, result: 'pong' },
        ],
      })
    })
  })

  describe('ids', () => {
    const handler = createHandler(router)

    it.each([
      ['abc'],
      [''],
      [0],
      [-1],
      [1.5],
      [Number.MAX_SAFE_INTEGER],
      [null],
    ])('echoes id %j', async (id) => {
      const { response } = await handler.handle(createRequest({ jsonrpc: '2.0', method: 'ping', id }), { context: {} })

      expect(response?.body).toEqual({ jsonrpc: '2.0', id, result: 'pong' })
    })

    it('answers a request with a null id, which is not a notification', async () => {
      const { response } = await handler.handle(createRequest({ jsonrpc: '2.0', method: 'unknown', id: null }), { context: {} })

      expect(response).toEqual({ status: 200, headers: {}, body: { jsonrpc: '2.0', id: null, error: METHOD_NOT_FOUND } })
    })

    it('treats an undefined id member as absent (notification)', async () => {
      const { response } = await handler.handle(createRequest({ jsonrpc: '2.0', method: 'ping', id: undefined }), { context: {} })

      expect(response).toEqual({ status: 204, headers: {}, body: undefined })
    })
  })

  describe('params', () => {
    const handler = createHandler({
      ...router,
      optional: os.input(z.object({ limit: z.number().optional() })).handler(({ input }) => input),
      nothing: os.input(z.void()).handler(({ input }) => input ?? 'void'),
    })

    it.each([
      [{}],
      [{ params: null }],
      [{ params: [] }],
      [{ params: {} }],
    ])('normalizes empty params %j for all-optional and void inputs', async (params) => {
      const optional = await handler.handle(createRequest({ jsonrpc: '2.0', method: 'optional', id: 1, ...params }), { context: {} })
      expect(optional.response?.body).toEqual({ jsonrpc: '2.0', id: 1, result: {} })

      const voidLike = await handler.handle(createRequest({ jsonrpc: '2.0', method: 'nothing', id: 1, ...params }), { context: {} })
      expect(voidLike.response?.body).toEqual({ jsonrpc: '2.0', id: 1, result: 'void' })
    })

    it('passes positional and named params as the input', async () => {
      for (const [params, result] of [
        [['x'], 'x'],
        [[[1, 2]], [1, 2]],
        [[null], null],
        [{ a: 1 }, { a: 1 }],
      ] as const) {
        const { response } = await handler.handle(createRequest({ jsonrpc: '2.0', method: 'echo', params, id: 1 }), { context: {} })

        expect(response?.body).toEqual({ jsonrpc: '2.0', id: 1, result })
      }
    })
  })

  describe('body', () => {
    it('reads the body exactly once with the json hint', async () => {
      const handler = createHandler(router)

      const single = createRequest({ jsonrpc: '2.0', method: 'ping', id: 1 })
      await handler.handle(single, { context: {} })
      expect(single.resolveBody).toHaveBeenCalledTimes(1)
      expect(single.resolveBody).toHaveBeenCalledWith('json')

      const batch = createRequest([
        { jsonrpc: '2.0', method: 'ping', id: 1 },
        { jsonrpc: '2.0', method: 'echo', params: ['x'], id: 2 },
        { jsonrpc: '2.0', method: 'planet.find', params: { id: 1 } },
      ])
      await handler.handle(batch, { context: {} })
      expect(batch.resolveBody).toHaveBeenCalledTimes(1)
      expect(batch.resolveBody).toHaveBeenCalledWith('json')
    })

    it('parses an application/json-rpc body through the real fetch adapter', async () => {
      const handler = new FetchHandler(createHandler(router))

      const { response } = await handler.handle(new Request('https://example.com/', {
        method: 'POST',
        headers: { 'content-type': 'application/json-rpc' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
      }))

      expect(response?.status).toBe(200)
      expect(response?.headers.get('content-type')).toBe('application/json')
      await expect(response?.json()).resolves.toEqual({ jsonrpc: '2.0', id: 1, result: 'pong' })
    })

    it('answers invalid JSON through the real fetch adapter with "Parse error"', async () => {
      const handler = new FetchHandler(createHandler(router))

      const { response } = await handler.handle(new Request('https://example.com/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"jsonrpc": "2.0", "method": "foobar, "params": "bar", "baz]',
      }))

      expect(response?.status).toBe(200)
      await expect(response?.json()).resolves.toEqual({ jsonrpc: '2.0', id: null, error: PARSE_ERROR })
    })
  })

  describe('batches', () => {
    it('runs calls concurrently and keeps the request order', async () => {
      const finished: number[] = []
      let active = 0
      let maxActive = 0

      const handler = createHandler({
        delay: os.input(z.number()).handler(async ({ input }) => {
          active++
          maxActive = Math.max(maxActive, active)
          await sleep(input)
          active--
          finished.push(input)
          return input
        }),
      })

      const { response } = await handler.handle(createRequest([
        { jsonrpc: '2.0', method: 'delay', params: [60], id: 1 },
        { jsonrpc: '2.0', method: 'delay', params: [0], id: 2 },
        { jsonrpc: '2.0', method: 'delay', params: [30], id: 3 },
      ]), { context: {} })

      expect(maxActive).toBe(3)
      expect(finished).toEqual([0, 30, 60])
      expect(response?.body).toEqual([
        { jsonrpc: '2.0', id: 1, result: 60 },
        { jsonrpc: '2.0', id: 2, result: 0 },
        { jsonrpc: '2.0', id: 3, result: 30 },
      ])
    })

    it('uses the default max batch size of 100', async () => {
      const handler = createHandler(router)
      const call = { jsonrpc: '2.0', method: 'ping', id: 1 }

      const ok = await handler.handle(createRequest(Array.from({ length: 100 }).fill(call)), { context: {} })
      expect(ok.response?.status).toBe(200)
      expect(ok.response?.body).toHaveLength(100)

      const tooLarge = await handler.handle(createRequest(Array.from({ length: 101 }).fill(call)), { context: {} })
      expect(tooLarge.response?.status).toBe(413)
    })

    it('resolves maxBatchSize with the routing interceptor options', async () => {
      const maxBatchSize = vi.fn(async () => 1)
      const handler = createHandler(router, { maxBatchSize })
      const call = { jsonrpc: '2.0', method: 'ping', id: 1 }

      const request = createRequest([call, call], { url: '/rpc' })
      const { response } = await handler.handle(request, { context: { user: 'u' }, prefix: '/rpc' } as any)

      expect(response?.status).toBe(413)
      expect(maxBatchSize).toHaveBeenCalledTimes(1)
      expect(maxBatchSize).toHaveBeenCalledWith(expect.objectContaining({ request, context: { user: 'u' }, prefix: '/rpc' }))

      // single requests are not batches
      await expect(handler.handle(createRequest(call), { context: {} })).resolves.toMatchObject({ response: { status: 200 } })
      expect(maxBatchSize).toHaveBeenCalledTimes(1)
    })

    it('disables batches with maxBatchSize 0', async () => {
      const handler = createHandler(router, { maxBatchSize: 0 })

      const { response } = await handler.handle(createRequest([{ jsonrpc: '2.0', method: 'ping', id: 1 }]), { context: {} })

      expect(response).toEqual({
        status: 413,
        headers: {},
        body: {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32013, message: 'Batch requests are not supported.', data: { code: 'PAYLOAD_TOO_LARGE', defined: false } },
        },
      })

      await expect(handler.handle(createRequest({ jsonrpc: '2.0', method: 'ping', id: 1 }), { context: {} })).resolves.toMatchObject({
        response: { status: 200, body: { result: 'pong' } },
      })
    })

    it('rejects every batch when maxBatchSize resolves NaN', async () => {
      const handler = createHandler(router, { maxBatchSize: () => Number.NaN })

      const { response } = await handler.handle(createRequest([{ jsonrpc: '2.0', method: 'ping', id: 1 }]), { context: {} })

      expect(response?.status).toBe(413)
    })

    it('always uses 200 for a batch in mapped mode', async () => {
      const handler = createHandler(router, { errorResponseStatus: 'mapped' })

      const { response } = await handler.handle(createRequest([{ jsonrpc: '2.0', method: 'crash', id: 1 }]), { context: {} })

      expect(response?.status).toBe(200)
    })
  })

  describe('notifications', () => {
    it('waits for notifications to finish before answering', async () => {
      const effects: string[] = []
      const handler = createHandler({
        log: os.input(z.string()).handler(async ({ input }) => {
          await sleep(20)
          effects.push(input)
        }),
      })

      await expect(handler.handle(createRequest({ jsonrpc: '2.0', method: 'log', params: ['single'] }), { context: {} })).resolves.toMatchObject({
        response: { status: 204 },
      })
      expect(effects).toEqual(['single'])

      await expect(handler.handle(createRequest([
        { jsonrpc: '2.0', method: 'log', params: ['a'] },
        { jsonrpc: '2.0', method: 'log', params: ['b'] },
      ]), { context: {} })).resolves.toMatchObject({
        response: { status: 204 },
      })
      expect(effects).toEqual(['single', 'a', 'b'])
    })

    it('swallows errors of notifications in a batch', async () => {
      const handler = createHandler(router)

      const { response } = await handler.handle(createRequest([
        { jsonrpc: '2.0', method: 'crash' },
        { jsonrpc: '2.0', method: 'missing' },
        { jsonrpc: '2.0', method: 'unknown' },
        { jsonrpc: '2.0', method: 'ping', id: 1 },
      ]), { context: {} })

      expect(response?.body).toEqual([{ jsonrpc: '2.0', id: 1, result: 'pong' }])
    })

    it('cancels sub-response bodies nobody reads', async () => {
      const cancel = vi.fn()
      const handler = createHandler(router, {
        routingInterceptors: [
          async ({ request, next }) => {
            if (getJsonRpcCall(request)?.method === 'raw') {
              return { matched: true, response: { status: 200, headers: {}, body: new ReadableStream({ cancel }) } }
            }

            return next()
          },
        ],
      })

      await expect(handler.handle(createRequest({ jsonrpc: '2.0', method: 'raw' }), { context: {} })).resolves.toMatchObject({
        response: { status: 204 },
      })
      expect(cancel).toHaveBeenCalledTimes(1)

      await expect(handler.handle(createRequest({ jsonrpc: '2.0', method: 'raw', id: 1 }), { context: {} })).resolves.toMatchObject({
        response: { body: { jsonrpc: '2.0', id: 1, error: INTERNAL_ERROR } },
      })
      expect(cancel).toHaveBeenCalledTimes(2)
    })
  })

  describe('headers', () => {
    const headersByMethod: Record<string, StandardHeaders> = {
      a: { 'x-shared': '1', 'x-diff': 'a', 'set-cookie': ['a=1', 'same=1'], 'vary': 'Accept', 'content-type': 'text/plain', 'content-length': '5', 'standard-server': 'json' },
      b: { 'x-shared': '1', 'x-diff': 'b', 'set-cookie': 'same=1', 'vary': 'Origin, accept' },
    }

    const handler = createHandler({ a: os.handler(() => 'a'), b: os.handler(() => 'b') }, {
      interceptors: [
        async ({ next, path }) => {
          const response = await next()
          return { ...response, headers: { ...response.headers, ...headersByMethod[path.join('.')] } }
        },
      ],
    })

    it('forwards the sub-response headers of a single call, without body headers', async () => {
      const { response } = await handler.handle(createRequest({ jsonrpc: '2.0', method: 'a', id: 1 }), { context: {} })

      expect(response?.headers).toEqual({ 'x-shared': '1', 'x-diff': 'a', 'set-cookie': ['a=1', 'same=1'], 'vary': 'Accept' })
    })

    it('forwards the sub-response headers of a single notification', async () => {
      const { response } = await handler.handle(createRequest({ jsonrpc: '2.0', method: 'b' }), { context: {} })

      expect(response).toEqual({
        status: 204,
        headers: { 'x-shared': '1', 'x-diff': 'b', 'set-cookie': 'same=1', 'vary': 'Origin, accept' },
        body: undefined,
      })
    })

    it('lifts shared headers, cookies, and vary of a batch', async () => {
      const { response } = await handler.handle(createRequest([
        { jsonrpc: '2.0', method: 'a', id: 1 },
        { jsonrpc: '2.0', method: 'b', id: 2 },
      ]), { context: {} })

      expect(response?.headers).toEqual({ 'x-shared': '1', 'set-cookie': ['a=1', 'same=1'], 'vary': 'Accept, Origin' })
    })

    it('lifts cookies of a batch of notifications onto the 204', async () => {
      const { response } = await handler.handle(createRequest([
        { jsonrpc: '2.0', method: 'a' },
        { jsonrpc: '2.0', method: 'b' },
      ]), { context: {} })

      expect(response).toEqual({
        status: 204,
        headers: { 'x-shared': '1', 'set-cookie': ['a=1', 'same=1'], 'vary': 'Accept, Origin' },
        body: undefined,
      })
    })

    it('passes the HTTP request headers, signal, and context to each call', async () => {
      const controller = new AbortController()
      const context = vi.fn(() => ({ user: 'u' }))
      const seen: any[] = []

      const handler = createHandler({
        check: os.$context<{ user: string }>().handler(({ context, signal }) => {
          seen.push({ context, signal })
          return 'ok'
        }),
      }, {
        routingInterceptors: [
          async ({ request, next }) => {
            seen.push({ headers: request.headers })
            return next()
          },
        ],
      })

      await handler.handle(createRequest([
        { jsonrpc: '2.0', method: 'check', id: 1 },
        { jsonrpc: '2.0', method: 'check', id: 2 },
      ], {
        headers: { 'content-type': 'application/json', 'content-length': '100', 'authorization': 'Bearer t' },
        signal: controller.signal,
      }), { context })

      expect(context).toHaveBeenCalledTimes(1)
      expect(seen).toEqual([
        { headers: { 'content-type': 'application/json', 'content-length': undefined, 'authorization': 'Bearer t' } },
        { headers: { 'content-type': 'application/json', 'content-length': undefined, 'authorization': 'Bearer t' } },
        { context: expect.objectContaining({ user: 'u' }), signal: controller.signal },
        { context: expect.objectContaining({ user: 'u' }), signal: controller.signal },
      ])
    })
  })

  describe('interceptors', () => {
    it('lets inner routing interceptors see each call through getJsonRpcCall', async () => {
      const calls: any[] = []
      const handler = createHandler(router, {
        routingInterceptors: [
          async ({ request, next }) => {
            calls.push({ call: getJsonRpcCall(request), url: request.url, method: request.method, body: await request.resolveBody() })
            return next()
          },
        ],
      })

      await handler.handle(createRequest({ jsonrpc: '2.0', method: 'planet.find', params: { id: 1 }, id: 'x' }, { url: '/rpc' }), { context: {}, prefix: '/rpc' })
      await handler.handle(createRequest([
        { jsonrpc: '2.0', method: 'ping', id: 1 },
        { jsonrpc: '2.0', method: 'a b.c' },
      ]), { context: {} })

      expect(calls).toEqual([
        { call: { method: 'planet.find', id: 'x', notification: false, batch: false }, url: '/rpc/planet/find', method: 'POST', body: { id: 1 } },
        { call: { method: 'ping', id: 1, notification: false, batch: true }, url: '/ping', method: 'POST', body: undefined },
        { call: { method: 'a b.c', id: undefined, notification: true, batch: true }, url: '/a%20b/c', method: 'POST', body: undefined },
      ])
    })

    it('lets inner routing interceptors answer a call', async () => {
      const handler = createHandler(router, {
        routingInterceptors: [
          async ({ request, next }) => {
            if (getJsonRpcCall(request)?.method === 'virtual') {
              return { matched: true, response: { status: 200, headers: {}, body: { result: 'virtual' } } }
            }

            return next()
          },
        ],
      })

      const { response } = await handler.handle(createRequest({ jsonrpc: '2.0', method: 'virtual', id: 1 }), { context: {} })

      expect(response?.body).toEqual({ jsonrpc: '2.0', id: 1, result: 'virtual' })
    })

    it('lets a plugin ordered after ~openrpc see the raw HTTP request, and one ordered before see each call', async () => {
      const seen: { plugin: string, url: string, call: unknown }[] = []

      function createLoggerPlugin(name: string, order: Pick<StandardHandlerPlugin<any>, 'before' | 'after'>): StandardHandlerPlugin<any> {
        return {
          name,
          ...order,
          init: options => ({
            ...options,
            routingInterceptors: [
              async ({ request, next }) => {
                seen.push({ plugin: name, url: request.url, call: getJsonRpcCall(request) })
                return next()
              },
              ...toArray(options.routingInterceptors),
            ],
          }),
        }
      }

      const handler = createHandler(router, {
        plugins: [
          createLoggerPlugin('outer', { after: ['~openrpc'] }),
          createLoggerPlugin('inner', { before: ['~openrpc'] }),
        ],
      })

      const { response } = await handler.handle(createRequest([
        { jsonrpc: '2.0', method: 'ping', id: 1 },
        { jsonrpc: '2.0', method: 'planet.find', params: { id: 2 }, id: 2 },
      ], { url: '/rpc' }), { context: {}, prefix: '/rpc' })

      expect(response?.body).toEqual([
        { jsonrpc: '2.0', id: 1, result: 'pong' },
        { jsonrpc: '2.0', id: 2, result: { id: 2, name: 'Earth' } },
      ])
      expect(seen).toEqual([
        { plugin: 'outer', url: '/rpc', call: undefined },
        { plugin: 'inner', url: '/rpc/ping', call: { method: 'ping', id: 1, notification: false, batch: true } },
        { plugin: 'inner', url: '/rpc/planet/find', call: { method: 'planet.find', id: 2, notification: false, batch: true } },
      ])
    })

    it('does not read a sub-request as another envelope when installed twice', async () => {
      const handler = createHandler(router, { plugins: [new OpenRPCEnvelopeHandlerPlugin()] })

      const { response } = await handler.handle(createRequest([{ jsonrpc: '2.0', method: 'echo', params: [{ jsonrpc: '2.0', method: 'ping', id: 9 }], id: 1 }]), { context: {} })

      expect(response?.body).toEqual([{ jsonrpc: '2.0', id: 1, result: { jsonrpc: '2.0', method: 'ping', id: 9 } }])
    })
  })

  describe('internal errors', () => {
    it('rethrows a routing interceptor error of a single call', async () => {
      const error = new Error('boom')
      const handler = createHandler(router, {
        routingInterceptors: [
          async () => {
            throw error
          },
        ],
      })

      await expect(handler.handle(createRequest({ jsonrpc: '2.0', method: 'ping', id: 1 }), { context: {} })).rejects.toBe(error)
      await expect(handler.handle(createRequest({ jsonrpc: '2.0', method: 'ping' }), { context: {} })).rejects.toBe(error)
    })

    it('answers a routing interceptor error of a batch item with "Internal error"', async ({ onTestFinished }) => {
      const rejectSpy = vi.spyOn(Promise, 'reject').mockImplementation(() => new Promise(() => {}) as Promise<never>)
      onTestFinished(() => {
        rejectSpy.mockRestore()
      })

      const error = new Error('boom')
      const handler = createHandler(router, {
        routingInterceptors: [
          async ({ request, next }) => {
            if (getJsonRpcCall(request)?.method === 'boom') {
              throw error
            }

            return next()
          },
        ],
      })

      const { response } = await handler.handle(createRequest([
        { jsonrpc: '2.0', method: 'boom', id: 1 },
        { jsonrpc: '2.0', method: 'boom' },
        { jsonrpc: '2.0', method: 'ping', id: 2 },
      ]), { context: {} })

      expect(response).toEqual({
        status: 200,
        headers: {},
        body: [
          { jsonrpc: '2.0', id: 1, error: INTERNAL_ERROR },
          { jsonrpc: '2.0', id: 2, result: 'pong' },
        ],
      })
      expect(rejectSpy).toHaveBeenCalledTimes(2)
      expect(rejectSpy).toHaveBeenCalledWith(error)
    })

    it('keeps the rethrow plugin working for single calls', async ({ onTestFinished }) => {
      const rejectSpy = vi.spyOn(Promise, 'reject').mockImplementation(() => new Promise(() => {}) as Promise<never>)
      onTestFinished(() => {
        rejectSpy.mockRestore()
      })

      const handler = createHandler(router, {
        plugins: [new RethrowHandlerPlugin({ filter: error => !(error instanceof ORPCError) })],
      })

      await expect(handler.handle(createRequest({ jsonrpc: '2.0', method: 'crash', id: 1 }), { context: {} })).rejects.toThrow('secret database error')
      await expect(handler.handle(createRequest({ jsonrpc: '2.0', method: 'missing', id: 1 }), { context: {} })).resolves.toMatchObject({
        response: { body: { error: { code: -32004 } } },
      })

      const { response } = await handler.handle(createRequest([{ jsonrpc: '2.0', method: 'crash', id: 1 }]), { context: {} })
      expect(response?.body).toEqual([{ jsonrpc: '2.0', id: 1, error: INTERNAL_ERROR }])
      expect(rejectSpy).toHaveBeenCalledTimes(1)
    })

    it.each([
      [{ code: 1.5, message: 'x' }],
      [{ code: 1 }],
      [{ message: 'x' }],
    ])('answers an invalid custom error object %j with "Internal error"', async (errorObject) => {
      for (const errorResponseStatus of ['always-200', 'mapped'] as const) {
        const handler = createHandler(router, { errorResponseStatus, customErrorEncoder: () => errorObject as any })

        const single = await handler.handle(createRequest({ jsonrpc: '2.0', method: 'missing', id: 1 }), { context: {} })
        expect(single.response).toEqual({
          status: errorResponseStatus === 'mapped' ? 500 : 200,
          headers: {},
          body: { jsonrpc: '2.0', id: 1, error: INTERNAL_ERROR },
        })

        const batch = await handler.handle(createRequest([{ jsonrpc: '2.0', method: 'missing', id: 1 }]), { context: {} })
        expect(batch.response?.body).toEqual([{ jsonrpc: '2.0', id: 1, error: INTERNAL_ERROR }])

        const rejected = await handler.handle(createRequest({}, { headers: { 'content-type': 'text/plain' } }), { context: {} })
        expect(rejected.response).toEqual({
          status: 500,
          headers: {},
          body: { jsonrpc: '2.0', id: null, error: INTERNAL_ERROR },
        })
      }
    })

    it('uses the custom error encoder and maps for transport rejections', async () => {
      const handler = createHandler(router, {
        customErrorEncoder: error => error.code === 'UNSUPPORTED_MEDIA_TYPE' ? { code: 415, message: 'custom' } : null,
        errorCodeMap: { PAYLOAD_TOO_LARGE: 413 },
        errorStatusMap: { UNSUPPORTED_MEDIA_TYPE: 400 },
      })

      const unsupported = await handler.handle(createRequest({}, { headers: {} }), { context: {} })
      expect(unsupported.response).toEqual({ status: 400, headers: {}, body: { jsonrpc: '2.0', id: null, error: { code: 415, message: 'custom' } } })

      const tooLarge = await handler.handle(createRequest(undefined, { resolveBody: vi.fn().mockRejectedValue(new ORPCError('PAYLOAD_TOO_LARGE')) }), { context: {} })
      expect(tooLarge.response).toEqual({
        status: 400,
        headers: {},
        body: { jsonrpc: '2.0', id: null, error: { code: 413, message: 'Payload Too Large', data: { code: 'PAYLOAD_TOO_LARGE', defined: false } } },
      })
    })
  })

  describe('with real plugins', () => {
    it('sorts with the real ordered plugins without a cycle', () => {
      const plugins: StandardHandlerPlugin<any>[] = [
        new OpenRPCEnvelopeHandlerPlugin(),
        new TracingHandlerPlugin(),
        new CORSHandlerPlugin(),
        new RequestLimitHandlerPlugin({ maxBodySize: 1 }),
        new RequestCompressionHandlerPlugin(),
        new ResponseCompressionHandlerPlugin(),
        new ResponseHeadersHandlerPlugin(),
        new TmpFileUploadHandlerPlugin(),
        new PinoHandlerPlugin(),
        new RequestHeadersHandlerPlugin(),
        new SignalSyncHandlerPlugin(),
        new RethrowHandlerPlugin({ filter: () => true }),
        new RateLimitHandlerPlugin(),
        // not applicable to JSON-RPC, but sorting must not fail when they are installed anyway
        new BatchHandlerPlugin(),
        new MethodOverrideHandlerPlugin(),
      ]

      const names = sortPlugins(plugins).map(plugin => plugin.name)

      // a plugin that prepends its routing interceptor and is initialized later wraps the ones before it
      expect(names.indexOf('~openrpc')).toBeGreaterThan(names.indexOf('~tracing'))
      expect(names.indexOf('~tracing')).toBeGreaterThan(names.indexOf('~pino'))

      for (const outer of ['~cors', '~request-limit', '~request-compression', '~response-compression', '~response-headers', '~tmp-file-upload']) {
        expect(names.indexOf(outer)).toBeGreaterThan(names.indexOf('~openrpc'))
      }

      // the handler adds its own envelope plugin
      expect(() => createHandler(router, { plugins: plugins.slice(1) })).not.toThrow()
    })

    it('does not bypass the request limit plugin', async () => {
      const handlerFn = vi.fn(() => 'ok')
      const handler = new FetchHandler(createHandler({ ping: os.handler(handlerFn) }, {
        plugins: [new RequestLimitHandlerPlugin({ maxBodySize: 64 })],
      }))

      const big = JSON.stringify({ jsonrpc: '2.0', method: 'ping', params: ['x'.repeat(100)], id: 1 })

      for (const headers of [{ 'content-type': 'application/json' }, { 'content-type': 'application/json', 'content-length': String(big.length) }]) {
        const { response } = await handler.handle(new Request('https://example.com/', { method: 'POST', headers, body: big }))

        expect(response?.status).toBe(413)
        await expect(response?.json()).resolves.toEqual({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32013, message: 'Payload Too Large', data: { code: 'PAYLOAD_TOO_LARGE', defined: false } },
        })
      }

      const { response } = await handler.handle(new Request('https://example.com/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
      }))
      await expect(response?.json()).resolves.toEqual({ jsonrpc: '2.0', id: 1, result: 'ok' })
      expect(handlerFn).toHaveBeenCalledTimes(1)
    })

    it('answers CORS preflights and adds CORS headers to the HTTP response', async () => {
      const handler = new FetchHandler(createHandler(router, {
        plugins: [new CORSHandlerPlugin({ origin: 'https://app.example.com', allowHeaders: ['content-type'] })],
      }))

      const preflight = await handler.handle(new Request('https://example.com/rpc', {
        method: 'OPTIONS',
        headers: { 'origin': 'https://app.example.com', 'access-control-request-method': 'POST' },
      }), { prefix: '/rpc' })

      expect(preflight.response?.status).toBe(204)
      expect(preflight.response?.headers.get('access-control-allow-origin')).toBe('https://app.example.com')
      expect(preflight.response?.headers.get('access-control-allow-headers')).toBe('content-type')

      for (const body of [
        { jsonrpc: '2.0', method: 'ping', id: 1 },
        [{ jsonrpc: '2.0', method: 'ping', id: 1 }],
        { jsonrpc: '2.0', method: 'ping' },
      ]) {
        const { response } = await handler.handle(new Request('https://example.com/rpc', {
          method: 'POST',
          headers: { 'origin': 'https://app.example.com', 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }), { prefix: '/rpc' })

        expect(response?.headers.get('access-control-allow-origin')).toBe('https://app.example.com')
        expect(response?.headers.get('vary')).toBe('Origin')
      }
    })

    it('collects cookies every call of a batch sets with the response headers plugin', async () => {
      const handler = new FetchHandler(createHandler({
        login: os.$context<{ resHeaders?: Headers }>().input(z.string()).handler(({ input, context }) => {
          context.resHeaders?.append('set-cookie', `${input}=1`)
          context.resHeaders?.set('x-last', input)
          return input
        }),
      }, {
        plugins: [new ResponseHeadersHandlerPlugin()],
      }))

      const { response } = await handler.handle(new Request('https://example.com/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([
          { jsonrpc: '2.0', method: 'login', params: ['a'], id: 1 },
          { jsonrpc: '2.0', method: 'login', params: ['b'] },
        ]),
      }))

      expect(response?.status).toBe(200)
      expect(response?.headers.getSetCookie()).toEqual(['a=1', 'b=1'])
      expect(['a', 'b']).toContain(response?.headers.get('x-last'))
      await expect(response?.json()).resolves.toEqual([{ jsonrpc: '2.0', id: 1, result: 'a' }])
    })

    it.each([
      ['always-200', 200],
      ['mapped', 429],
    ] as const)('forwards the rate limit headers of a single call (%s)', async (errorResponseStatus, status) => {
      const limited = os.use(ratelimit({ limiter: new MemoryRateLimiter({ maxRequests: 1, window: 60_000 }), key: 'key' })).handler(() => 'ok')
      const handler = createHandler({ limited }, { errorResponseStatus, plugins: [new RateLimitHandlerPlugin()] })

      const first = await handler.handle(createRequest({ jsonrpc: '2.0', method: 'limited', id: 1 }), { context: {} })
      expect(first.response?.status).toBe(200)
      expect(first.response?.headers).toMatchObject({ 'ratelimit-limit': '1', 'ratelimit-remaining': '0' })
      expect(first.response?.headers['retry-after']).toBeUndefined()

      const second = await handler.handle(createRequest({ jsonrpc: '2.0', method: 'limited', id: 2 }), { context: {} })
      expect(second.response?.status).toBe(status)
      expect(second.response?.headers).toMatchObject({ 'ratelimit-limit': '1', 'ratelimit-remaining': '0', 'retry-after': expect.any(String) })
      expect(second.response?.body).toMatchObject({ jsonrpc: '2.0', id: 2, error: { code: -32029, data: { code: 'TOO_MANY_REQUESTS' } } })
    })

    it('creates one tracing span per call', async ({ onTestFinished }) => {
      interface MockSpan extends TracingSpan {
        initialName: string
        name: string
        attributes: Record<string, unknown>
        ended: boolean
      }

      const spans: MockSpan[] = []
      const storage = new AsyncLocalStorage<MockSpan>()

      function createSpan(name: string): MockSpan {
        const span: MockSpan = {
          initialName: name,
          name,
          attributes: {},
          ended: false,
          setAttribute(key, value) {
            span.attributes[key] = value
          },
          updateName(name) {
            span.name = name
          },
          addEvent() {},
          recordException() {},
          end() {
            span.ended = true
          },
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

      const handler = createHandler(router)

      await handler.handle(createRequest([
        { jsonrpc: '2.0', method: 'ping', id: 1 },
        { jsonrpc: '2.0', method: 'planet.find', params: { id: 1 } },
        { jsonrpc: '2.0', method: 'unknown', id: 3 },
        1,
      ], { url: '/rpc' }), { context: {}, prefix: '/rpc' })

      const callSpans = spans.filter(span => span.initialName.startsWith('POST '))

      expect(callSpans.map(span => ({ initialName: span.initialName, name: span.name, method: span.attributes['rpc.method'], ended: span.ended }))).toEqual([
        { initialName: 'POST /rpc/ping', name: 'orpc.ping', method: 'ping', ended: true },
        { initialName: 'POST /rpc/planet/find', name: 'orpc.planet/find', method: 'planet.find', ended: true },
        { initialName: 'POST /rpc/unknown', name: 'orpc_no_match', method: undefined, ended: true },
      ])
    })
  })
})
