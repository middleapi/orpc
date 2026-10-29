import type { StandardUrl } from '@standard-server/core'
import { MalformedResponseError, ORPCError, ResponseError } from '@orpc/client'
import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { OpenRPCLinkCodec } from './openrpc-link-codec'

function expectORPCErrorResult(
  result: any,
  code: string,
  options: {
    defined: boolean
    message?: string
    data?: unknown
  },
) {
  expect(result.kind).toBe('error')
  expect(result.error).toBeInstanceOf(ORPCError)
  expect(result.error.code).toBe(code)
  expect(result.error.defined).toBe(options.defined)

  if (options.message !== undefined) {
    expect(result.error.message).toBe(options.message)
  }

  if (options.data !== undefined) {
    expect(result.error.data).toEqual(options.data)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('openRPCLinkCodec', () => {
  describe('.encodeInput', () => {
    it('builds a POST JSON-RPC request with default url and headers', async () => {
      const codec = new OpenRPCLinkCodec()

      const request = await codec.encodeInput({ id: 1 }, ['planet', 'find'], { context: {} })

      expect(request).toEqual({
        method: 'POST',
        url: '/',
        headers: {},
        body: { jsonrpc: '2.0', id: '1', method: 'planet.find', params: { id: 1 } },
        signal: undefined,
      })
    })

    it('uses the url, headers and signal of the call', async () => {
      const codec = new OpenRPCLinkCodec({ url: '/rpc', headers: { authorization: 'Bearer token' } })
      const signal = AbortSignal.timeout(100)

      const request = await codec.encodeInput('input', ['ping'], { context: {}, signal })

      expect(request.url).toBe('/rpc')
      expect(request.headers).toEqual({ authorization: 'Bearer token' })
      expect(request.signal).toBe(signal)
    })

    it('generates sequential base-36 string ids per codec', async () => {
      const codec = new OpenRPCLinkCodec()
      const other = new OpenRPCLinkCodec()
      const encodeId = async (codec: OpenRPCLinkCodec<any>) => ((await codec.encodeInput('a', ['ping'], { context: {} })).body as { id: string }).id

      const ids: string[] = []

      for (let i = 0; i < 36; i++) {
        ids.push(await encodeId(codec))
      }

      expect([ids[0], ids[1], ids[9], ids[35]]).toEqual(['1', '2', 'a', '10'])
      await expect(encodeId(other)).resolves.toBe('1')
    })

    describe('params', () => {
      it('sends plain objects by-name', async () => {
        const codec = new OpenRPCLinkCodec()

        const request = await codec.encodeInput({ id: 1, name: 'earth' }, ['ping'], { context: {} })

        expect(request.body).toEqual({ jsonrpc: '2.0', id: '1', method: 'ping', params: { id: 1, name: 'earth' } })
      })

      it.each([
        ['a string', 'text', ['text']],
        ['a number', 42, [42]],
        ['null', null, [null]],
        ['an array', [1, 2], [[1, 2]]],
      ])('sends %s by-position', async (_, input, params) => {
        const codec = new OpenRPCLinkCodec()

        const request = await codec.encodeInput(input, ['ping'], { context: {} })

        expect(request.body).toEqual({ jsonrpc: '2.0', id: '1', method: 'ping', params })
      })

      it('omits params for undefined input', async () => {
        const codec = new OpenRPCLinkCodec()

        const request = await codec.encodeInput(undefined, ['ping'], { context: {} })

        expect(request.body).toEqual({ jsonrpc: '2.0', id: '1', method: 'ping' })
        expect(request.body).not.toHaveProperty('params')
      })

      it('serializes params like OpenAPI JSON', async () => {
        const codec = new OpenRPCLinkCodec()

        const request = await codec.encodeInput({
          date: new Date('2024-01-02T03:04:05.000Z'),
          bigint: 123n,
          set: new Set([1, 2]),
          nested: { url: new URL('https://orpc.dev'), missing: undefined },
        }, ['ping'], { context: {} })

        expect(request.body).toEqual({
          jsonrpc: '2.0',
          id: '1',
          method: 'ping',
          params: {
            date: '2024-01-02T03:04:05.000Z',
            bigint: '123',
            set: [1, 2],
            nested: { url: 'https://orpc.dev/' },
          },
        })
      })
    })

    it.each([
      ['a Blob', () => new Blob(['data'])],
      ['a nested File', () => ({ avatar: new File(['data'], 'avatar.png') })],
      ['a ReadableStream', () => new ReadableStream()],
      ['an async iterator', () => (async function* () { yield 1 })()],
    ])('throws for %s input before assigning an id', async (_, factory) => {
      const codec = new OpenRPCLinkCodec()

      await expect(codec.encodeInput(factory(), ['planet', 'upload'], { context: {} })).rejects.toThrow(
        new TypeError('[OpenRPCLink] JSON-RPC cannot send streams or binary data in call to procedure (planet.upload).'),
      )

      const request = await codec.encodeInput('next', ['ping'], { context: {} })
      expect(request.body).toMatchObject({ id: '1' })
    })

    describe('option handling', () => {
      it('supports url as a function', async () => {
        const url = vi.fn(async () => '/dynamic' as StandardUrl)
        const codec = new OpenRPCLinkCodec({ url })
        const options = { context: {} }

        const request = await codec.encodeInput('input', ['ping'], options)

        expect(request.url).toBe('/dynamic')
        expect(url).toHaveBeenCalledWith(options, ['ping'], 'input')
      })

      it('supports headers as a function', async () => {
        const headers = vi.fn(async () => ({ 'x-dynamic': 'yes' }))
        const codec = new OpenRPCLinkCodec({ headers })
        const options = { context: {} }

        const request = await codec.encodeInput('input', ['ping'], options)

        expect(request.headers).toEqual({ 'x-dynamic': 'yes' })
        expect(headers).toHaveBeenCalledWith(options, ['ping'], 'input')
      })

      it('uses a custom serializer', async () => {
        const codec = new OpenRPCLinkCodec({
          serializer: new OpenAPIJsonSerializer({
            handlers: {
              date: { condition: v => v instanceof Date, serialize: (v: Date) => v.getTime(), isTerminal: true },
            },
          }),
        })

        const request = await codec.encodeInput({ at: new Date(5) }, ['ping'], { context: {} })

        expect(request.body).toMatchObject({ params: { at: 5 } })
      })
    })
  })

  describe('.decodeResponse', () => {
    /**
     * Encodes a call first, so the codec knows the request id (`'1'`) the response must answer.
     */
    async function decode(body: unknown, { status = 200, headers = {} }: { status?: number, headers?: Record<string, string> } = {}) {
      const codec = new OpenRPCLinkCodec()
      const options = { context: {} }
      const resolveBody = vi.fn(async () => body)

      await codec.encodeInput('input', ['ping'], options)

      return {
        resolveBody,
        result: await codec.decodeResponse({ status, headers, resolveBody }, ['ping'], options),
      }
    }

    it('returns the result as output', async () => {
      const { result, resolveBody } = await decode({ jsonrpc: '2.0', id: '1', result: { ok: true } })

      expect(result).toEqual({ kind: 'output', output: { ok: true } })
      expect(resolveBody).toHaveBeenCalledOnce()
      expect(resolveBody).toHaveBeenCalledWith('json')
    })

    it('restores ORPCErrors of oRPC servers, including their defined flag', async () => {
      const body = {
        jsonrpc: '2.0',
        id: '1',
        error: { code: -32004, message: 'Planet not found', data: { code: 'NOT_FOUND', defined: true, data: { id: 2 } } },
      }

      const { result } = await decode(body, { headers: { 'x-request-id': 'abc' } }) as { result: any }

      expectORPCErrorResult(result, 'NOT_FOUND', { defined: true, message: 'Planet not found', data: { id: 2 } })
      expect(result.error.cause).toBeInstanceOf(ResponseError)
      expect(result.error.cause).not.toBeInstanceOf(MalformedResponseError)
      expect(result.error.cause.message).toBe('Received JSON-RPC error -32004.')
      expect(result.error.cause.response).toEqual({ status: 404, headers: { 'x-request-id': 'abc' }, body })
    })

    it('maps errors of other servers by their JSON-RPC code', async () => {
      const { result } = await decode({ jsonrpc: '2.0', id: '1', error: { code: -32601, message: 'Method not found', data: '0x' } })

      expectORPCErrorResult(result, 'NOT_FOUND', { defined: false, message: 'Method not found', data: '0x' })
    })

    it('keeps data of other servers that only partly looks like an oRPC error', async () => {
      const data = { code: 'NOT_FOUND', data: { id: 2 } }

      const { result } = await decode({ jsonrpc: '2.0', id: '1', error: { code: -32603, message: 'Failed', data } })

      expectORPCErrorResult(result, 'INTERNAL_SERVER_ERROR', { defined: false, data })
    })

    it.each([
      ['the status of the oRPC code', 200, { code: 'TOO_MANY_REQUESTS', defined: false }, 429],
      ['the status of the mapped code', 200, undefined, 500],
      ['the real error status', 503, { code: 'NOT_FOUND', defined: false }, 503],
      ['400 for an unknown code', 200, { code: 'OUT_OF_STOCK', defined: true }, 400],
    ])('gives the error cause %s', async (_, status, data, expected) => {
      const { result } = await decode({ jsonrpc: '2.0', id: '1', error: { code: -32000, message: 'Failed', data } }, { status }) as { result: any }

      expect(result.error.cause.response.status).toBe(expected)
    })

    describe('request ids', () => {
      it.each([
        ['another id', { jsonrpc: '2.0', id: '2', result: 1 }],
        ['the id as a number', { jsonrpc: '2.0', id: 1, result: 1 }],
        ['a null id', { jsonrpc: '2.0', id: null, result: 1 }],
        ['another id on an error', { jsonrpc: '2.0', id: '2', error: { code: -32603, message: 'Failed' } }],
      ])('rejects a response with %s', async (_, body) => {
        await expect(decode(body)).rejects.toThrow(new MalformedResponseError({
          message: 'Invalid JSON-RPC response.',
          response: { status: 200, headers: {}, body },
        }))
      })

      it('accepts an error with a null id, which the server could not relate to the request', async () => {
        const { result } = await decode({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })

        expectORPCErrorResult(result, 'BAD_REQUEST', { defined: false, message: 'Parse error' })
      })

      it('matches each response to the id of its own call', async () => {
        const codec = new OpenRPCLinkCodec()
        const first = { context: {} }
        const second = { context: {} }

        await codec.encodeInput('a', ['ping'], first)
        await codec.encodeInput('b', ['ping'], second)

        const respond = (id: string) => ({ status: 200, headers: {}, resolveBody: async () => ({ jsonrpc: '2.0', id, result: id }) })

        await expect(codec.decodeResponse(respond('2'), ['ping'], second)).resolves.toEqual({ kind: 'output', output: '2' })
        await expect(codec.decodeResponse(respond('1'), ['ping'], first)).resolves.toEqual({ kind: 'output', output: '1' })
        await expect(codec.decodeResponse(respond('2'), ['ping'], first)).rejects.toThrow('Invalid JSON-RPC response.')
      })
    })

    it.each([
      ['a batch', [{ jsonrpc: '2.0', id: '1', result: 1 }]],
      ['a string', '<html></html>'],
    ])('throws MalformedResponseError on %s', async (_, body) => {
      const error: any = await decode(body, { status: 502 }).then(() => null, e => e)

      expect(error).toBeInstanceOf(MalformedResponseError)
      expect(error.message).toBe('Invalid JSON-RPC response.')
      expect(error.response).toEqual({ status: 502, headers: {}, body })
    })

    it('throws MalformedResponseError when the body is not JSON', async () => {
      const codec = new OpenRPCLinkCodec()
      const cause = new SyntaxError('Unexpected token \'<\'')

      const error: any = await codec.decodeResponse({
        status: 502,
        headers: { 'content-type': 'text/html' },
        resolveBody: async () => {
          throw cause
        },
      }, ['ping'], { context: {} }).then(() => null, e => e)

      expect(error).toBeInstanceOf(MalformedResponseError)
      expect(error.message).toBe('Bad Gateway')
      expect(error.response).toEqual({ status: 502, headers: { 'content-type': 'text/html' }, body: undefined })
      expect(error.cause).toBe(cause)
    })

    it('rethrows the abort reason when aborted while reading the body', async () => {
      const codec = new OpenRPCLinkCodec()
      const controller = new AbortController()
      const reason = new Error('aborted')

      await expect(codec.decodeResponse({
        status: 200,
        headers: {},
        resolveBody: async () => {
          controller.abort(reason)
          throw reason
        },
      }, ['ping'], { context: {}, signal: controller.signal })).rejects.toBe(reason)
    })
  })
})
