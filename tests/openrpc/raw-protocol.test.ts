import { ORPCError } from '@orpc/client'
import { OpenRPCGenerator } from '@orpc/openrpc'
import { OpenRPCDiscoveryHandlerPlugin } from '@orpc/openrpc/plugins'
import { os } from '@orpc/server'
import { CORSHandlerPlugin, RequestLimitHandlerPlugin } from '@orpc/server/plugins'
import { ZodToJsonSchemaConverter } from '@orpc/zod'
import { sleep } from '@standard-server/shared'
import { z } from 'zod'
import { OPENRPC_PREFIX } from './__shared__/client-server'
import { createHonoFetchClientServerTest } from './__shared__/client-server.hono-fetch'
import { createNodeHttpClientServerTest } from './__shared__/client-server.node-http'

function postTo(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

/**
 * Talks to `OpenRPCHandler` over real HTTP with hand-written JSON-RPC payloads.
 */
describe.each([
  ['hono-fetch', createHonoFetchClientServerTest],
  ['node-http', createNodeHttpClientServerTest],
])('openrpc raw protocol: %s', (_name, createClientServer) => {
  const logs: string[] = []

  const router = {
    math: {
      subtract: os
        .input(z.object({ minuend: z.number(), subtrahend: z.number() }))
        .handler(({ input }) => input.minuend - input.subtrahend),
      sum: os
        .input(z.array(z.number()))
        .handler(({ input }) => input.reduce((total, value) => total + value, 0)),
    },
    ping: os.handler(() => 'pong'),
    list: os
      .input(z.object({ limit: z.number().optional() }))
      .handler(({ input }) => input.limit ?? 10),
    log: os
      .input(z.object({ message: z.string() }))
      .handler(async ({ input }) => {
        await sleep(20)
        logs.push(input.message)
      }),
    conflict: os.handler(() => {
      throw new ORPCError('CONFLICT', { message: 'Already exists', data: { id: 1 } })
    }),
  }

  const spec = new OpenRPCGenerator({ converters: [new ZodToJsonSchemaConverter()] })
    .generate(router, { base: { info: { title: 'Raw Protocol', version: '1.0.0' } } })

  const { origin, url } = createClientServer(router, {
    handler: {
      maxBatchSize: 8,
      plugins: [
        new CORSHandlerPlugin(),
        new RequestLimitHandlerPlugin({ maxBodySize: 1024 }),
        new OpenRPCDiscoveryHandlerPlugin({ spec: () => spec }),
      ],
    },
  })

  const post = (body: unknown, headers?: Record<string, string>) => postTo(url, body, headers)

  beforeEach(() => {
    logs.length = 0
  })

  describe('single calls', () => {
    it('answers a call with params by-name', async () => {
      const response = await post({ jsonrpc: '2.0', method: 'math.subtract', params: { minuend: 42, subtrahend: 23 }, id: 1 })

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('application/json')
      await expect(response.json()).resolves.toEqual({ jsonrpc: '2.0', id: 1, result: 19 })
    })

    it('answers a call with params by-position', async () => {
      const response = await post({ jsonrpc: '2.0', method: 'math.sum', params: [[1, 2, 4]], id: 'abc' })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ jsonrpc: '2.0', id: 'abc', result: 7 })
    })

    it('answers a call with id: null', async () => {
      const response = await post({ jsonrpc: '2.0', method: 'ping', id: null })

      await expect(response.json()).resolves.toEqual({ jsonrpc: '2.0', id: null, result: 'pong' })
    })

    it.each([
      ['absent', {}],
      ['null', { params: null }],
      ['an empty array', { params: [] }],
      ['an empty object', { params: {} }],
    ])('accepts %s params for procedures without required input', async (_, params) => {
      await expect((await post({ jsonrpc: '2.0', method: 'ping', id: 1, ...params })).json())
        .resolves
        .toEqual({ jsonrpc: '2.0', id: 1, result: 'pong' })

      await expect((await post({ jsonrpc: '2.0', method: 'list', id: 2, ...params })).json())
        .resolves
        .toEqual({ jsonrpc: '2.0', id: 2, result: 10 })
    })

    it('rejects more than one positional param with "Invalid params"', async () => {
      const response = await post({ jsonrpc: '2.0', method: 'math.subtract', params: [42, 23], id: 1 })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32602,
          message: 'Invalid params: expected at most 1 positional parameter, received 2.',
          data: { code: 'BAD_REQUEST', defined: false },
        },
      })
    })

    it('answers procedure errors with the error object', async () => {
      const response = await post({ jsonrpc: '2.0', method: 'conflict', id: 7 })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        jsonrpc: '2.0',
        id: 7,
        error: { code: -32009, message: 'Already exists', data: { code: 'CONFLICT', defined: false, data: { id: 1 } } },
      })
    })

    it('answers unknown and reserved methods with "Method not found"', async () => {
      for (const method of ['missing', 'math', 'math.', 'rpc.other', '']) {
        const response = await post({ jsonrpc: '2.0', method, id: 1 })

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } })
      }
    })

    it('answers invalid request objects with "Invalid Request"', async () => {
      const cases: [payload: unknown, id: unknown][] = [
        [{ jsonrpc: '1.0', method: 'ping', id: 3 }, 3],
        [{ jsonrpc: '2.0', method: 1, id: 'x' }, 'x'],
        [{ jsonrpc: '2.0', method: 'ping', params: 'bar', id: 4 }, 4],
        [{ jsonrpc: '2.0', method: 'ping', id: {} }, null],
        [{ foo: 'boo' }, null],
        [1, null],
        [{}, null],
      ]

      for (const [payload, id] of cases) {
        const response = await post(payload)

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } })
      }
    })

    it('answers unparsable bodies with "Parse error"', async () => {
      for (const body of ['{"jsonrpc": "2.0", "method": "foobar, "params": "bar", "baz]', '']) {
        const response = await post(body)

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      }
    })

    it('accepts the JSON-RPC media types', async () => {
      for (const contentType of ['application/json-rpc', 'application/jsonrequest', 'application/json; charset=utf-8', 'Application/JSON']) {
        const response = await post({ jsonrpc: '2.0', method: 'ping', id: 1 }, { 'content-type': contentType })

        await expect(response.json()).resolves.toEqual({ jsonrpc: '2.0', id: 1, result: 'pong' })
      }
    })

    it('rejects other content types with 415', async () => {
      const response = await post({ jsonrpc: '2.0', method: 'ping', id: 1 }, { 'content-type': 'text/plain' })

      expect(response.status).toBe(415)
      await expect(response.json()).resolves.toEqual({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32015,
          message: 'JSON-RPC requests must use Content-Type: application/json',
          data: { code: 'UNSUPPORTED_MEDIA_TYPE', defined: false },
        },
      })
    })

    it('rejects bodies over the request limit with 413', async () => {
      const response = await post({ jsonrpc: '2.0', method: 'log', params: { message: 'x'.repeat(2048) }, id: 1 })

      expect(response.status).toBe(413)
      await expect(response.json()).resolves.toEqual({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32013, message: 'Payload Too Large', data: { code: 'PAYLOAD_TOO_LARGE', defined: false } },
      })
      expect(logs).toEqual([])
    })
  })

  describe('notifications', () => {
    it('runs a notification before answering 204 with no body', async () => {
      const response = await post({ jsonrpc: '2.0', method: 'log', params: { message: 'hello' } })

      expect(response.status).toBe(204)
      expect(response.headers.get('content-type')).toBe(null)
      await expect(response.text()).resolves.toBe('')
      expect(logs).toEqual(['hello'])
    })

    it('never answers a notification, even a failing one', async () => {
      for (const payload of [
        { jsonrpc: '2.0', method: 'conflict' },
        { jsonrpc: '2.0', method: 'missing' },
        { jsonrpc: '2.0', method: 'log', params: { message: 1 } },
      ]) {
        const response = await post(payload)

        expect(response.status).toBe(204)
        await expect(response.text()).resolves.toBe('')
      }
    })
  })

  describe('batch requests', () => {
    it('answers a batch in request order, omitting notifications', async () => {
      const response = await post([
        { jsonrpc: '2.0', method: 'math.sum', params: [[1, 2, 4]], id: '1' },
        { jsonrpc: '2.0', method: 'log', params: { message: 'batched' } },
        { jsonrpc: '2.0', method: 'math.subtract', params: { minuend: 42, subtrahend: 23 }, id: '2' },
        { foo: 'boo' },
        { jsonrpc: '2.0', method: 'missing', id: '5' },
        { jsonrpc: '2.0', method: 'conflict', id: 9 },
        1,
      ])

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('application/json')
      await expect(response.json()).resolves.toEqual([
        { jsonrpc: '2.0', id: '1', result: 7 },
        { jsonrpc: '2.0', id: '2', result: 19 },
        { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } },
        { jsonrpc: '2.0', id: '5', error: { code: -32601, message: 'Method not found' } },
        { jsonrpc: '2.0', id: 9, error: { code: -32009, message: 'Already exists', data: { code: 'CONFLICT', defined: false, data: { id: 1 } } } },
        { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } },
      ])
      // notifications in a batch also run before the response
      expect(logs).toEqual(['batched'])
    })

    it('answers a one-element batch with an array', async () => {
      const response = await post([{ jsonrpc: '2.0', method: 'ping', id: 1 }])

      await expect(response.json()).resolves.toEqual([{ jsonrpc: '2.0', id: 1, result: 'pong' }])
    })

    it('answers a batch of only notifications with 204 and no body', async () => {
      const response = await post([
        { jsonrpc: '2.0', method: 'log', params: { message: 'a' } },
        { jsonrpc: '2.0', method: 'log', params: { message: 'b' } },
      ])

      expect(response.status).toBe(204)
      await expect(response.text()).resolves.toBe('')
      expect([...logs].sort()).toEqual(['a', 'b'])
    })

    it('answers an empty batch with a single "Invalid Request"', async () => {
      const response = await post([])

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } })
    })

    it('rejects batches over maxBatchSize with 413', async () => {
      const response = await post(Array.from({ length: 9 }, (_, id) => ({ jsonrpc: '2.0', method: 'log', params: { message: 'x' }, id })))

      expect(response.status).toBe(413)
      await expect(response.json()).resolves.toEqual({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32013, message: 'Batch size exceeds the maximum of 8.', data: { code: 'PAYLOAD_TOO_LARGE', defined: false } },
      })
      expect(logs).toEqual([])
    })
  })

  describe('transport', () => {
    it('answers CORS preflight requests', async () => {
      const response = await fetch(url, {
        method: 'OPTIONS',
        headers: {
          'origin': 'https://app.example.com',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      })

      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
      expect(response.headers.get('access-control-allow-methods')).toContain('POST')
      expect(response.headers.get('access-control-allow-headers')).toBe('content-type')
    })

    it('sets the CORS headers on JSON-RPC responses, rejections included', async () => {
      const headers = { origin: 'https://app.example.com' }

      for (const response of [
        await post({ jsonrpc: '2.0', method: 'ping', id: 1 }, headers),
        await post([{ jsonrpc: '2.0', method: 'ping', id: 1 }], headers),
        await post({ jsonrpc: '2.0', method: 'ping' }, headers),
        await post({ jsonrpc: '2.0', method: 'ping', id: 1 }, { ...headers, 'content-type': 'text/plain' }),
      ]) {
        expect(response.headers.get('access-control-allow-origin')).toBe('*')
      }
    })

    it('leaves other methods and paths unmatched', async () => {
      expect((await fetch(url)).status).toBe(404)
      expect((await fetch(`${url}/ping`)).status).toBe(404)

      expect((await postTo(`${origin}/elsewhere`, { jsonrpc: '2.0', method: 'ping', id: 1 })).status).toBe(404)
    })

    it('does not route JSON-RPC methods by URL', async () => {
      expect((await postTo(`${url}/ping`, { jsonrpc: '2.0', method: 'ping', id: 1 })).status).toBe(404)
    })
  })

  describe('service discovery', () => {
    it('serves the OpenRPC document over GET', async () => {
      const response = await fetch(`${url}/openrpc.json`)

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('application/json')

      const document = await response.json()
      expect(document).toEqual(await spec)
      expect(document).toMatchObject({
        openrpc: '1.3.2',
        info: { title: 'Raw Protocol', version: '1.0.0' },
        methods: [
          { name: 'math.subtract' },
          { name: 'math.sum' },
          { name: 'ping' },
          { name: 'list' },
          { name: 'log' },
          { name: 'conflict' },
        ],
      })
    })

    it('answers rpc.discover, alone and in a batch', async () => {
      const document = await spec

      await expect((await post({ jsonrpc: '2.0', method: 'rpc.discover', id: 1 })).json())
        .resolves
        .toEqual({ jsonrpc: '2.0', id: 1, result: document })

      await expect((await post([
        { jsonrpc: '2.0', method: 'rpc.discover', id: 1 },
        { jsonrpc: '2.0', method: 'ping', id: 2 },
      ])).json()).resolves.toEqual([
        { jsonrpc: '2.0', id: 1, result: document },
        { jsonrpc: '2.0', id: 2, result: 'pong' },
      ])
    })

    it('serves the document relative to the prefix only', async () => {
      expect(url).toBe(`${origin}${OPENRPC_PREFIX}`)
      expect((await fetch(`${origin}/openrpc.json`)).status).toBe(404)
      expect((await fetch(`${url}/other.json`)).status).toBe(404)
    })
  })

  describe('with errorResponseStatus: "mapped"', () => {
    const { url: mappedUrl } = createClientServer(router, {
      handler: { errorResponseStatus: 'mapped' },
    })

    const post = (body: unknown) => postTo(mappedUrl, body)

    it('maps the HTTP status of single error responses', async () => {
      const cases: [body: unknown, status: number, code: number][] = [
        ['{', 400, -32700],
        [{ foo: 'boo' }, 400, -32600],
        [{ jsonrpc: '2.0', method: 'missing', id: 1 }, 404, -32601],
        [{ jsonrpc: '2.0', method: 'math.subtract', params: { minuend: 'x' }, id: 1 }, 400, -32602],
        [{ jsonrpc: '2.0', method: 'conflict', id: 1 }, 409, -32009],
      ]

      for (const [body, status, code] of cases) {
        const response = await post(body)

        expect(response.status).toBe(status)
        await expect(response.json()).resolves.toMatchObject({ jsonrpc: '2.0', error: { code } })
      }
    })

    it('keeps 200 for successes and batches, and 204 for notifications', async () => {
      expect((await post({ jsonrpc: '2.0', method: 'ping', id: 1 })).status).toBe(200)
      expect((await post([{ jsonrpc: '2.0', method: 'conflict', id: 1 }])).status).toBe(200)
      expect((await post({ jsonrpc: '2.0', method: 'conflict' })).status).toBe(204)
    })
  })
})
