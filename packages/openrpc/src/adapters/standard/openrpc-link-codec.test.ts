import type { ClientOptions } from '@orpc/client'
import type { StandardLazyResponse } from '@standard-server/core'
import { isDefinedError, MalformedResponseError, ORPCError, ResponseError } from '@orpc/client'
import { isRetryableError } from '@orpc/client/plugins'
import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { toStandardLazyResponse } from '@standard-server/fetch'
import { OpenRPCLinkCodec } from './openrpc-link-codec'

function jsonResponse(body: unknown, init: { status?: number, contentType?: string } = {}): StandardLazyResponse {
  return toStandardLazyResponse(new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': init.contentType ?? 'application/json' },
  }))
}

function lazyResponse(body: unknown, init: { status?: number, headers?: Record<string, string> } = {}) {
  const resolveBody = vi.fn(async (_hint?: string) => body)
  const response: StandardLazyResponse = {
    status: init.status ?? 200,
    headers: init.headers ?? { 'content-type': 'application/json' },
    resolveBody,
  }

  return { response, resolveBody }
}

async function encodeCall(codec: OpenRPCLinkCodec<any>, input: unknown = undefined, path = ['planet', 'find']) {
  const options: ClientOptions<any> = { context: {} }
  const request = await codec.encodeInput(input, path, options)

  return { options, request, body: request.body as any }
}

describe('openRPCLinkCodec', () => {
  describe('.encodeInput', () => {
    it('builds a JSON-RPC request with by-name params', async () => {
      const codec = new OpenRPCLinkCodec()

      const request = await codec.encodeInput({ id: 1, name: 'earth' }, ['planet', 'find'], { context: {} })

      expect(request).toEqual({
        method: 'POST',
        url: '/',
        headers: {},
        body: { jsonrpc: '2.0', method: 'planet.find', params: { id: 1, name: 'earth' }, id: 1 },
        signal: undefined,
      })
    })

    it.each([
      ['a string', 'earth', ['earth']],
      ['a number', 42, [42]],
      ['null', null, [null]],
      ['a boolean', false, [false]],
      ['an array', [1, 2], [[1, 2]]],
      ['an empty array', [], [[]]],
      ['a Set', new Set([1, 2]), [[1, 2]]],
      ['a Map', new Map([['a', 1]]), [[['a', 1]]]],
      ['a Date', new Date('2024-01-02T03:04:05.000Z'), ['2024-01-02T03:04:05.000Z']],
    ])('sends %s by-position as [input]', async (_, input, params) => {
      const { body } = await encodeCall(new OpenRPCLinkCodec(), input)

      expect(body.params).toEqual(params)
    })

    it('sends an empty or null-prototype object by-name', async () => {
      const codec = new OpenRPCLinkCodec()
      const nullProto = Object.assign(Object.create(null), { a: 1 })

      expect((await encodeCall(codec, {})).body.params).toEqual({})
      expect((await encodeCall(codec, nullProto)).body.params).toEqual({ a: 1 })
    })

    it('omits params for an undefined input', async () => {
      const { body } = await encodeCall(new OpenRPCLinkCodec(), undefined)

      expect(body).toEqual({ jsonrpc: '2.0', method: 'planet.find', id: 1 })
      expect(Object.hasOwn(body, 'params')).toBe(false)
    })

    it('serializes native types with the serializer', async () => {
      const { body } = await encodeCall(new OpenRPCLinkCodec(), {
        date: new Date('2024-01-02T03:04:05.000Z'),
        big: 10n,
        url: new URL('https://orpc.dev/'),
        set: new Set(['a']),
        nan: Number.NaN,
        skipped: undefined,
      })

      expect(body.params).toEqual({
        date: '2024-01-02T03:04:05.000Z',
        big: '10',
        url: 'https://orpc.dev/',
        set: ['a'],
        nan: null,
      })
      expect(Object.hasOwn(body.params, 'skipped')).toBe(false)
    })

    it('uses a custom serializer', async () => {
      const serializer = new OpenAPIJsonSerializer({ omitUndefinedProperties: false })
      const serializeJson = vi.spyOn(serializer, 'serializeJson')

      const { body } = await encodeCall(new OpenRPCLinkCodec({ serializer }), { a: undefined })

      expect(serializeJson).toHaveBeenCalledWith({ a: undefined })
      expect(body.params).toEqual({ a: null })
    })

    it('joins nested paths with dots and keeps router keys as they are', async () => {
      const codec = new OpenRPCLinkCodec()

      expect((await encodeCall(codec, undefined, ['ping'])).body.method).toBe('ping')
      expect((await encodeCall(codec, undefined, ['eth_getBalance'])).body.method).toBe('eth_getBalance')
      expect((await encodeCall(codec, undefined, ['a', 'b', 'c'])).body.method).toBe('a.b.c')
    })

    describe('encodeParams', () => {
      it('replaces the params mapping', async () => {
        const encodeParams = vi.fn((input: unknown) => input as unknown[])
        const codec = new OpenRPCLinkCodec({ encodeParams })

        const { body } = await encodeCall(codec, ['0xabc', new Date('2024-01-02T03:04:05.000Z')], ['eth_getBalance'])

        expect(body.params).toEqual(['0xabc', '2024-01-02T03:04:05.000Z'])
        expect(encodeParams).toHaveBeenCalledOnce()
        expect(encodeParams).toHaveBeenCalledWith(['0xabc', '2024-01-02T03:04:05.000Z'], ['eth_getBalance'])
      })

      it('receives undefined for an undefined input and can omit params', async () => {
        const encodeParams = vi.fn(() => undefined)
        const codec = new OpenRPCLinkCodec({ encodeParams })

        const { body } = await encodeCall(codec, undefined)

        expect(encodeParams).toHaveBeenCalledWith(undefined, ['planet', 'find'])
        expect(Object.hasOwn(body, 'params')).toBe(false)
      })

      it('can send objects by-position', async () => {
        const codec = new OpenRPCLinkCodec({ encodeParams: input => [input] })

        const { body } = await encodeCall(codec, { a: 1 })

        expect(body.params).toEqual([{ a: 1 }])
      })

      it.each([
        ['a string', 'x'],
        ['null', null],
        ['a number', 1],
        ['a class instance', new Date()],
      ])('rejects %s', async (_, params) => {
        const codec = new OpenRPCLinkCodec({ encodeParams: () => params as any })

        await expect(codec.encodeInput({ a: 1 }, ['planet', 'find'], { context: {} })).rejects.toThrow(
          new TypeError('[OpenRPCLink] "encodeParams" must return an array, a plain object, or undefined in call to procedure (planet.find).'),
        )
      })
    })

    describe('ids', () => {
      it('uses a new id for every call', async () => {
        const codec = new OpenRPCLinkCodec()

        const ids = []
        for (let i = 0; i < 3; i++) {
          ids.push((await encodeCall(codec)).body.id)
        }

        expect(ids).toEqual([1, 2, 3])
        expect((await encodeCall(new OpenRPCLinkCodec())).body.id).toBe(1)
      })

      it('wraps before ids lose integer precision', async () => {
        const codec = new OpenRPCLinkCodec()
        ;(codec as any).lastId = Number.MAX_SAFE_INTEGER - 1

        expect((await encodeCall(codec)).body.id).toBe(Number.MAX_SAFE_INTEGER)
        expect((await encodeCall(codec)).body.id).toBe(1)
      })
    })

    describe('notification', () => {
      it('sends a notification without id', async () => {
        const codec = new OpenRPCLinkCodec({ notification: true })

        const { body } = await encodeCall(codec, { a: 1 })

        expect(body).toEqual({ jsonrpc: '2.0', method: 'planet.find', params: { a: 1 } })
        expect(Object.hasOwn(body, 'id')).toBe(false)
      })

      it('resolves the option per call and skips ids for notifications', async () => {
        const notification = vi.fn(async (options: ClientOptions<{ notify?: boolean }>) => options.context.notify === true)
        const codec = new OpenRPCLinkCodec<{ notify?: boolean }>({ notification })

        const options = { context: { notify: true } }
        const notified = await codec.encodeInput('x', ['log'], options)
        const called = await codec.encodeInput('x', ['log'], { context: {} })

        expect(notification).toHaveBeenNthCalledWith(1, options, ['log'], 'x')
        expect((notified.body as any).id).toBeUndefined()
        expect((called.body as any).id).toBe(1)
      })
    })

    describe('url and headers', () => {
      it('accepts values', async () => {
        const codec = new OpenRPCLinkCodec({ url: '/rpc?v=1', headers: { 'x-api-key': 'key' } })

        const { request } = await encodeCall(codec)

        expect(request.url).toBe('/rpc?v=1')
        expect(request.headers).toEqual({ 'x-api-key': 'key' })
      })

      it('accepts (async) functions receiving the options, path and input', async () => {
        const url = vi.fn(async () => '/rpc' as const)
        const headers = vi.fn(async (options: ClientOptions<{ token: string }>) => ({ authorization: options.context.token }))
        const codec = new OpenRPCLinkCodec<{ token: string }>({ url, headers })

        const options = { context: { token: 'secret' } }
        const request = await codec.encodeInput({ a: 1 }, ['planet', 'find'], options)

        expect(request.url).toBe('/rpc')
        expect(request.headers).toEqual({ authorization: 'secret' })
        expect(url).toHaveBeenCalledWith(options, ['planet', 'find'], { a: 1 })
        expect(headers).toHaveBeenCalledWith(options, ['planet', 'find'], { a: 1 })
      })

      it('accepts Headers instances', async () => {
        const codec = new OpenRPCLinkCodec({ headers: new Headers({ 'x-a': '1', 'x-b': '2' }) })

        const { request } = await encodeCall(codec)

        expect(request.headers).toEqual({ 'x-a': '1', 'x-b': '2' })
      })
    })

    it('forwards the signal', async () => {
      const controller = new AbortController()
      const codec = new OpenRPCLinkCodec()

      const request = await codec.encodeInput(undefined, ['ping'], { context: {}, signal: controller.signal })

      expect(request.signal).toBe(controller.signal)
    })

    describe('unsupported inputs', () => {
      const message = '[OpenRPCLink] JSON-RPC cannot send Blob, File, FormData, URLSearchParams, or streams in call to procedure (upload).'

      it.each([
        ['a Blob', () => new Blob(['x'])],
        ['a File', () => new File(['x'], 'a.txt')],
        ['a ReadableStream', () => new ReadableStream()],
        ['an async iterator', () => (async function* () {})()],
        ['FormData', () => new FormData()],
        ['URLSearchParams', () => new URLSearchParams('a=1')],
        ['a nested Blob', () => ({ file: new Blob(['x']) })],
        ['a Blob in an array', () => [1, new File(['x'], 'a.txt')]],
      ])('rejects %s before sending', async (_, createInput) => {
        const encodeParams = vi.fn()
        const codec = new OpenRPCLinkCodec({ encodeParams })

        await expect(codec.encodeInput(createInput(), ['upload'], { context: {} })).rejects.toThrow(new TypeError(message))
        expect(encodeParams).not.toHaveBeenCalled()
      })
    })
  })

  describe('.decodeResponse', () => {
    it('decodes a result', async () => {
      const codec = new OpenRPCLinkCodec()
      const { options } = await encodeCall(codec, { id: 1 })

      const result = await codec.decodeResponse(
        jsonResponse({ jsonrpc: '2.0', id: 1, result: { name: 'earth' } }),
        ['planet', 'find'],
        options,
      )

      expect(result).toEqual({ kind: 'output', output: { name: 'earth' } })
    })

    it('decodes a null result', async () => {
      const codec = new OpenRPCLinkCodec()
      const { options } = await encodeCall(codec)

      const result = await codec.decodeResponse(jsonResponse({ jsonrpc: '2.0', id: 1, result: null }), ['ping'], options)

      expect(result).toEqual({ kind: 'output', output: null })
    })

    it.each([
      ['application/json', 'json'],
      ['application/json-rpc', 'json'],
      ['application/jsonrequest', 'json'],
      ['Application/JSON; charset=utf-8', 'json'],
      ['text/plain', undefined],
    ])('reads a %s body with the %s hint', async (contentType, hint) => {
      const codec = new OpenRPCLinkCodec()
      const { options } = await encodeCall(codec)
      const { response, resolveBody } = lazyResponse({ jsonrpc: '2.0', id: 1, result: 'pong' }, {
        headers: { 'content-type': contentType },
      })

      await codec.decodeResponse(response, ['ping'], options)

      expect(resolveBody).toHaveBeenCalledOnce()
      expect(resolveBody).toHaveBeenCalledWith(hint)
    })

    it('parses application/json-rpc response bodies', async () => {
      const codec = new OpenRPCLinkCodec()
      const { options } = await encodeCall(codec)

      const result = await codec.decodeResponse(
        jsonResponse({ jsonrpc: '2.0', id: 1, result: [1, 2] }, { contentType: 'application/json-rpc' }),
        ['ping'],
        options,
      )

      expect(result).toEqual({ kind: 'output', output: [1, 2] })
    })

    it('skips the id check when the call is unknown', async () => {
      const codec = new OpenRPCLinkCodec()

      const result = await codec.decodeResponse(jsonResponse({ jsonrpc: '2.0', id: 'other', result: 1 }), ['ping'], { context: {} })

      expect(result).toEqual({ kind: 'output', output: 1 })
    })

    describe('errors', () => {
      it('restores oRPC errors with their defined flag', async () => {
        const codec = new OpenRPCLinkCodec()
        const { options } = await encodeCall(codec)
        const body = {
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32004, message: 'Planet not found', data: { code: 'NOT_FOUND', defined: true, data: { id: 1 } } },
        }

        const result = await codec.decodeResponse(jsonResponse(body), ['planet', 'find'], options) as any

        expect(result.kind).toBe('error')
        expect(result.error).toBeInstanceOf(ORPCError)
        expect(isDefinedError(result.error)).toBe(true)
        expect(result.error.code).toBe('NOT_FOUND')
        expect(result.error.message).toBe('Planet not found')
        expect(result.error.data).toEqual({ id: 1 })

        expect(result.error.cause).toBeInstanceOf(ResponseError)
        expect(result.error.cause).not.toBeInstanceOf(MalformedResponseError)
        expect(result.error.cause.message).toBe('Received JSON-RPC error -32004.')
        expect(result.error.cause.response).toEqual({
          status: 404,
          headers: { 'content-type': 'application/json' },
          body,
        })
      })

      it('restores undefined errors without data', async () => {
        const codec = new OpenRPCLinkCodec()
        const { options } = await encodeCall(codec)

        const result = await codec.decodeResponse(jsonResponse({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32603, message: 'Internal server error', data: { code: 'INTERNAL_SERVER_ERROR', defined: false } },
        }), ['ping'], options) as any

        expect(result.error).toBeInstanceOf(ORPCError)
        expect(result.error.defined).toBe(false)
        expect(isDefinedError(result.error)).toBe(false)
        expect(result.error.code).toBe('INTERNAL_SERVER_ERROR')
        expect(result.error.data).toBeUndefined()
      })

      it('restores custom error codes', async () => {
        const codec = new OpenRPCLinkCodec()
        const { options } = await encodeCall(codec)

        const result = await codec.decodeResponse(jsonResponse({
          jsonrpc: '2.0',
          id: 1,
          error: { code: 1001, message: 'Out of stock', data: { code: 'OUT_OF_STOCK', defined: true, data: { left: 0 } } },
        }), ['buy'], options) as any

        expect(result.error.code).toBe('OUT_OF_STOCK')
        expect(result.error.defined).toBe(true)
        expect(result.error.data).toEqual({ left: 0 })
        expect(result.error.cause.response.status).toBe(400)
      })

      it.each([
        [-32700, 'BAD_REQUEST'],
        [-32600, 'BAD_REQUEST'],
        [-32601, 'NOT_FOUND'],
        [-32602, 'BAD_REQUEST'],
        [-32603, 'INTERNAL_SERVER_ERROR'],
        [-32000, 'INTERNAL_SERVER_ERROR'],
        [-32001, 'UNAUTHORIZED'],
        [-32013, 'PAYLOAD_TOO_LARGE'],
        [-32029, 'TOO_MANY_REQUESTS'],
        [-32099, 'CLIENT_CLOSED_REQUEST'],
        [-32050, 'INTERNAL_SERVER_ERROR'],
        [3, 'INTERNAL_SERVER_ERROR'],
      ])('maps the foreign error code %i to %s', async (code, orpcCode) => {
        const codec = new OpenRPCLinkCodec()
        const { options } = await encodeCall(codec)

        const result = await codec.decodeResponse(jsonResponse({
          jsonrpc: '2.0',
          id: 1,
          error: { code, message: 'Foreign error', data: 'details' },
        }), ['ping'], options) as any

        expect(result.kind).toBe('error')
        expect(result.error).toBeInstanceOf(ORPCError)
        expect(result.error.code).toBe(orpcCode)
        expect(result.error.defined).toBe(false)
        expect(result.error.message).toBe('Foreign error')
        expect(result.error.data).toBe('details')
      })

      it('keeps the protocol error object of foreign errors without data', async () => {
        const codec = new OpenRPCLinkCodec()
        const { options } = await encodeCall(codec)

        const result = await codec.decodeResponse(jsonResponse({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32601, message: 'Method not found' },
        }), ['ping'], options) as any

        expect(result.error.code).toBe('NOT_FOUND')
        expect(result.error.message).toBe('Method not found')
        expect(result.error.data).toBeUndefined()
        expect(result.error.cause.message).toBe('Received JSON-RPC error -32601.')
      })

      it('treats data with extra keys as foreign', async () => {
        const codec = new OpenRPCLinkCodec()
        const { options } = await encodeCall(codec)
        const data = { code: 'NOT_FOUND', defined: true, extra: 1 }

        const result = await codec.decodeResponse(jsonResponse({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32002, message: 'Payment required', data },
        }), ['ping'], options) as any

        expect(result.error.code).toBe('PAYMENT_REQUIRED')
        expect(result.error.defined).toBe(false)
        expect(result.error.data).toEqual(data)
      })

      describe('derived status', () => {
        it.each([
          ['BAD_REQUEST', -32602, 400, false],
          ['NOT_FOUND', -32004, 404, false],
          ['TIMEOUT', -32008, 408, true],
          ['TOO_MANY_REQUESTS', -32029, 429, true],
          ['INTERNAL_SERVER_ERROR', -32603, 500, true],
          ['SERVICE_UNAVAILABLE', -32603, 503, true],
          ['UNKNOWN_CODE', -32000, 400, false],
        ])('derives the status of %s from a 200 response', async (orpcCode, code, status, retryable) => {
          const codec = new OpenRPCLinkCodec()
          const { options } = await encodeCall(codec)

          const result = await codec.decodeResponse(jsonResponse({
            jsonrpc: '2.0',
            id: 1,
            error: { code, message: 'x', data: { code: orpcCode, defined: false } },
          }), ['ping'], options) as any

          expect(result.error.cause.response.status).toBe(status)
          expect(isRetryableError(result.error)).toBe(retryable)
        })

        it('derives the status of foreign errors from the reverse-mapped code', async () => {
          const codec = new OpenRPCLinkCodec()
          const { options } = await encodeCall(codec)

          const result = await codec.decodeResponse(jsonResponse({
            jsonrpc: '2.0',
            id: 1,
            error: { code: -32603, message: 'Internal error' },
          }), ['ping'], options) as any

          expect(result.error.cause.response.status).toBe(500)
          expect(isRetryableError(result.error)).toBe(true)
        })

        it('keeps the real status of a 4xx/5xx response', async () => {
          const codec = new OpenRPCLinkCodec()
          const { options } = await encodeCall(codec)

          const result = await codec.decodeResponse(jsonResponse({
            jsonrpc: '2.0',
            id: 1,
            error: { code: -32029, message: 'Too many requests', data: { code: 'TOO_MANY_REQUESTS', defined: false } },
          }, { status: 503 }), ['ping'], options) as any

          expect(result.error.code).toBe('TOO_MANY_REQUESTS')
          expect(result.error.cause.response.status).toBe(503)
        })

        it('uses a custom errorStatusMap', async () => {
          const codec = new OpenRPCLinkCodec({ errorStatusMap: { OUT_OF_STOCK: 409 } })
          const { options } = await encodeCall(codec)

          const outOfStock = await codec.decodeResponse(jsonResponse({
            jsonrpc: '2.0',
            id: 1,
            error: { code: 1001, message: 'x', data: { code: 'OUT_OF_STOCK', defined: true } },
          }), ['ping'], options) as any

          expect(outOfStock.error.cause.response.status).toBe(409)

          const second = await encodeCall(codec)
          const internal = await codec.decodeResponse(jsonResponse({
            jsonrpc: '2.0',
            id: 2,
            error: { code: -32603, message: 'x', data: { code: 'INTERNAL_SERVER_ERROR', defined: false } },
          }), ['ping'], second.options) as any

          expect(internal.error.cause.response.status).toBe(400)
        })

        it('ignores inherited errorStatusMap keys', async () => {
          const codec = new OpenRPCLinkCodec()
          const { options } = await encodeCall(codec)

          const result = await codec.decodeResponse(jsonResponse({
            jsonrpc: '2.0',
            id: 1,
            error: { code: -32000, message: 'x', data: { code: 'toString', defined: false } },
          }), ['ping'], options) as any

          expect(result.error.code).toBe('toString')
          expect(result.error.cause.response.status).toBe(400)
        })
      })

      describe('customErrorDecoder', () => {
        it('takes precedence over the default decoding', async () => {
          const customError = new ORPCError('BAD_GATEWAY', { data: 'custom' })
          const customErrorDecoder = vi.fn(() => customError)
          const codec = new OpenRPCLinkCodec({ customErrorDecoder })
          const { options } = await encodeCall(codec)
          const error = { code: -32004, message: 'x', data: { code: 'NOT_FOUND', defined: true } }
          const response = jsonResponse({ jsonrpc: '2.0', id: 1, error })

          const result = await codec.decodeResponse(response, ['ping'], options)

          expect(result).toEqual({ kind: 'error', error: customError })
          expect(customErrorDecoder).toHaveBeenCalledOnce()
          expect(customErrorDecoder).toHaveBeenCalledWith(error, response)
        })

        it.each([null, undefined])('falls back to the default decoding when it returns %s', async (returned) => {
          const codec = new OpenRPCLinkCodec({ customErrorDecoder: () => returned })
          const { options } = await encodeCall(codec)

          const result = await codec.decodeResponse(jsonResponse({
            jsonrpc: '2.0',
            id: 1,
            error: { code: -32004, message: 'x', data: { code: 'NOT_FOUND', defined: true } },
          }), ['ping'], options) as any

          expect(result.error.code).toBe('NOT_FOUND')
          expect(result.error.defined).toBe(true)
        })

        it('gets a ResponseError cause with the status of its own code when it returns an error without one', async () => {
          const codec = new OpenRPCLinkCodec({
            errorStatusMap: { CONFLICT: 409, INTERNAL_SERVER_ERROR: 500 },
            customErrorDecoder: error => new ORPCError(
              error.code === 1 ? 'CONFLICT' : error.code === 2 ? 'INTERNAL_SERVER_ERROR' : 'OUT_OF_STOCK',
              { message: error.message },
            ),
          })

          const decode = async (code: number, status?: number) => {
            const { options, body } = await encodeCall(codec)
            const result = await codec.decodeResponse(jsonResponse({ jsonrpc: '2.0', id: body.id, error: { code, message: 'x' } }, { status }), ['ping'], options)

            return (result as { error: ORPCError<any, any> }).error
          }

          const conflict = await decode(1)
          expect(conflict.code).toBe('CONFLICT')
          expect(conflict.cause).toBeInstanceOf(ResponseError)
          expect((conflict.cause as ResponseError).message).toBe('Received JSON-RPC error 1.')
          expect((conflict.cause as ResponseError).response).toEqual({ status: 409, headers: { 'content-type': 'application/json' }, body: { jsonrpc: '2.0', id: expect.any(Number), error: { code: 1, message: 'x' } } })
          expect(Object.getOwnPropertyDescriptor(conflict, 'cause')).toMatchObject({ enumerable: false, writable: true, configurable: true })
          expect(isRetryableError(conflict)).toBe(false)

          // codes missing from the map fall back to DEFAULT_ERROR_STATUS (400)
          const outOfStock = await decode(1001)
          expect((outOfStock.cause as ResponseError).response.status).toBe(400)
          expect(isRetryableError(outOfStock)).toBe(false)

          const internal = await decode(2)
          expect((internal.cause as ResponseError).response.status).toBe(500)
          expect(isRetryableError(internal)).toBe(true)

          // an error status of the response itself is kept
          const unavailable = await decode(1, 503)
          expect((unavailable.cause as ResponseError).response.status).toBe(503)
        })

        it('keeps the cause of an error it returns', async () => {
          const cause = new Error('custom cause')
          const customError = new ORPCError('OUT_OF_STOCK', { cause })
          const codec = new OpenRPCLinkCodec({ customErrorDecoder: () => customError })
          const { options, body } = await encodeCall(codec)

          const result = await codec.decodeResponse(jsonResponse({ jsonrpc: '2.0', id: body.id, error: { code: 1001, message: 'x' } }), ['ping'], options)

          expect(result).toEqual({ kind: 'error', error: customError })
          expect(customError.cause).toBe(cause)
        })

        it('is not called for results', async () => {
          const customErrorDecoder = vi.fn()
          const codec = new OpenRPCLinkCodec({ customErrorDecoder })
          const { options } = await encodeCall(codec)

          await codec.decodeResponse(jsonResponse({ jsonrpc: '2.0', id: 1, result: 1 }), ['ping'], options)

          expect(customErrorDecoder).not.toHaveBeenCalled()
        })
      })
    })

    describe('malformed responses', () => {
      it.each([
        ['an array', [{ jsonrpc: '2.0', id: 1, result: 1 }]],
        ['a string', 'pong'],
        ['null', null],
        ['a wrong jsonrpc version', { jsonrpc: '1.0', id: 1, result: 1 }],
        ['a missing jsonrpc', { id: 1, result: 1 }],
        ['a missing id', { jsonrpc: '2.0', result: 1 }],
        ['both result and error', { jsonrpc: '2.0', id: 1, result: 1, error: { code: -32603, message: 'x' } }],
        ['neither result nor error', { jsonrpc: '2.0', id: 1 }],
        ['a non-integer error code', { jsonrpc: '2.0', id: 1, error: { code: 1.5, message: 'x' } }],
        ['an error without message', { jsonrpc: '2.0', id: 1, error: { code: -32603 } }],
      ])('rejects %s', async (_, body) => {
        const codec = new OpenRPCLinkCodec()
        const { options } = await encodeCall(codec)
        const response = jsonResponse(body)

        const error: any = await codec.decodeResponse(response, ['ping'], options).then(() => null, e => e)

        expect(error).toBeInstanceOf(MalformedResponseError)
        expect(error.message).toBe('Invalid JSON-RPC response.')
        expect(error.response).toEqual({ status: 200, headers: { 'content-type': 'application/json' }, body })
      })

      it('rejects a 204 response to a request', async () => {
        const codec = new OpenRPCLinkCodec()
        const { options } = await encodeCall(codec)

        const error: any = await codec.decodeResponse(
          toStandardLazyResponse(new Response(null, { status: 204 })),
          ['ping'],
          options,
        ).then(() => null, e => e)

        expect(error).toBeInstanceOf(MalformedResponseError)
        expect(error.message).toBe('Invalid JSON-RPC response.')
        expect(error.response).toEqual({ status: 204, headers: {}, body: undefined })
      })

      it('describes a non-JSON-RPC error response by its status', async () => {
        const codec = new OpenRPCLinkCodec()
        const { options } = await encodeCall(codec)

        const error: any = await codec.decodeResponse(
          toStandardLazyResponse(new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } })),
          ['ping'],
          options,
        ).then(() => null, e => e)

        expect(error).toBeInstanceOf(MalformedResponseError)
        expect(error.message).toBe('Bad Gateway')
        expect(error.response.status).toBe(502)
        expect(error.response.body).toBeInstanceOf(ReadableStream)
      })

      it('rejects a mismatched id', async () => {
        const codec = new OpenRPCLinkCodec()
        const { options } = await encodeCall(codec)

        const error: any = await codec.decodeResponse(
          jsonResponse({ jsonrpc: '2.0', id: 2, result: 1 }),
          ['ping'],
          options,
        ).then(() => null, e => e)

        expect(error).toBeInstanceOf(MalformedResponseError)
        expect(error.message).toBe('JSON-RPC response id does not match the request id.')
      })

      it('compares ids strictly', async () => {
        const codec = new OpenRPCLinkCodec()
        const { options } = await encodeCall(codec)

        await expect(codec.decodeResponse(jsonResponse({ jsonrpc: '2.0', id: '1', result: 1 }), ['ping'], options))
          .rejects
          .toThrow('JSON-RPC response id does not match the request id.')
      })

      it('matches each attempt by its own options', async () => {
        const codec = new OpenRPCLinkCodec()
        const first = await encodeCall(codec)
        const second = await encodeCall(codec)

        await expect(codec.decodeResponse(jsonResponse({ jsonrpc: '2.0', id: 1, result: 1 }), ['ping'], second.options))
          .rejects
          .toThrow('JSON-RPC response id does not match the request id.')
        await expect(codec.decodeResponse(jsonResponse({ jsonrpc: '2.0', id: 1, result: 1 }), ['ping'], first.options))
          .resolves
          .toEqual({ kind: 'output', output: 1 })
        await expect(codec.decodeResponse(jsonResponse({ jsonrpc: '2.0', id: 2, result: 2 }), ['ping'], second.options))
          .resolves
          .toEqual({ kind: 'output', output: 2 })
      })

      it('accepts a null id only on error responses', async () => {
        const codec = new OpenRPCLinkCodec()
        const { options } = await encodeCall(codec)

        await expect(codec.decodeResponse(jsonResponse({ jsonrpc: '2.0', id: null, result: 1 }), ['ping'], options))
          .rejects
          .toThrow('JSON-RPC response id does not match the request id.')

        const result = await codec.decodeResponse(jsonResponse({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32015, message: 'Unsupported media type', data: { code: 'UNSUPPORTED_MEDIA_TYPE', defined: false } },
        }, { status: 415 }), ['ping'], options) as any

        expect(result.error.code).toBe('UNSUPPORTED_MEDIA_TYPE')
        expect(result.error.cause.response.status).toBe(415)
      })

      it('ignores inherited members', async () => {
        const codec = new OpenRPCLinkCodec()
        const { options } = await encodeCall(codec)
        const body = Object.assign(Object.create({ result: 1 }), { jsonrpc: '2.0', id: 1 })
        const { response } = lazyResponse(body)

        await expect(codec.decodeResponse(response, ['ping'], options)).rejects.toBeInstanceOf(MalformedResponseError)
      })

      it('rejects an unreadable body', async () => {
        const codec = new OpenRPCLinkCodec()
        const { options } = await encodeCall(codec)

        const error: any = await codec.decodeResponse(
          toStandardLazyResponse(new Response('{invalid', { headers: { 'content-type': 'application/json', 'x-trace': '1' } })),
          ['ping'],
          options,
        ).then(() => null, e => e)

        expect(error).toBeInstanceOf(MalformedResponseError)
        expect(error.message).toBe('Failed to read the JSON-RPC response body.')
        expect(error.cause).toBeInstanceOf(SyntaxError)
        expect(error.response).toEqual({
          status: 200,
          headers: { 'content-type': 'application/json', 'x-trace': '1' },
          body: undefined,
        })
      })

      it('rethrows body read errors of aborted calls', async () => {
        const codec = new OpenRPCLinkCodec()
        const controller = new AbortController()
        const options = { context: {}, signal: controller.signal }
        await codec.encodeInput(undefined, ['ping'], options)
        const abortError = new DOMException('aborted', 'AbortError')

        controller.abort()

        await expect(codec.decodeResponse({
          status: 200,
          headers: { 'content-type': 'application/json' },
          resolveBody: async () => {
            throw abortError
          },
        }, ['ping'], options)).rejects.toBe(abortError)
      })
    })

    describe('notifications', () => {
      it('resolves undefined for a 204 response', async () => {
        const codec = new OpenRPCLinkCodec({ notification: true })
        const { options } = await encodeCall(codec)

        const result = await codec.decodeResponse(toStandardLazyResponse(new Response(null, { status: 204 })), ['log'], options)

        expect(result).toEqual({ kind: 'output', output: undefined })
      })

      it('resolves undefined and cancels an unexpected body of a successful response', async () => {
        const codec = new OpenRPCLinkCodec({ notification: true })
        const { options } = await encodeCall(codec)
        const cancel = vi.fn()
        const stream = new ReadableStream({ cancel })
        const { response } = lazyResponse(stream, { headers: {} })

        const result = await codec.decodeResponse(response, ['log'], options)

        expect(result).toEqual({ kind: 'output', output: undefined })
        expect(cancel).toHaveBeenCalledOnce()
      })

      it('resolves undefined for a JSON-RPC result', async () => {
        const codec = new OpenRPCLinkCodec({ notification: true })
        const { options } = await encodeCall(codec)

        const result = await codec.decodeResponse(jsonResponse({ jsonrpc: '2.0', id: null, result: 1 }), ['log'], options)

        expect(result).toEqual({ kind: 'output', output: undefined })
      })

      it('decodes a JSON-RPC error response', async () => {
        const codec = new OpenRPCLinkCodec({ notification: true })
        const { options } = await encodeCall(codec)

        const result = await codec.decodeResponse(jsonResponse({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32013, message: 'Payload too large', data: { code: 'PAYLOAD_TOO_LARGE', defined: false } },
        }, { status: 413 }), ['log'], options) as any

        expect(result.kind).toBe('error')
        expect(result.error.code).toBe('PAYLOAD_TOO_LARGE')
        expect(result.error.cause.response.status).toBe(413)
      })

      it('decodes a JSON-RPC error delivered with 200', async () => {
        const codec = new OpenRPCLinkCodec({ notification: true })
        const { options } = await encodeCall(codec)

        const result = await codec.decodeResponse(jsonResponse({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        }), ['log'], options) as any

        expect(result.error.code).toBe('BAD_REQUEST')
        expect(result.error.cause.response.status).toBe(400)
      })

      it('rejects an unsuccessful non-JSON-RPC response', async () => {
        const codec = new OpenRPCLinkCodec({ notification: true })
        const { options } = await encodeCall(codec)

        const error: any = await codec.decodeResponse(
          toStandardLazyResponse(new Response('Bad Gateway', { status: 502, headers: { 'content-type': 'text/plain' } })),
          ['log'],
          options,
        ).then(() => null, e => e)

        expect(error).toBeInstanceOf(MalformedResponseError)
        expect(error.message).toBe('Bad Gateway')
        expect(error.response.status).toBe(502)
      })
    })
  })
})
