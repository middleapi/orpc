import { ORPCError } from '@orpc/client'
import { OpenAPIJsonSerializer } from '@orpc/openapi'
import {
  cancelQuietly,
  createJsonRpcProtocolErrorResponse,
  encodeJsonRpcError,
  isJsonRpcMediaType,
  isPartialResponseBody,
  liftSubresponseHeaders,
  omitBodyHeaders,
  parseJsonRpcRequest,
} from './utils'

describe('isJsonRpcMediaType', () => {
  it.each([
    ['application/json'],
    ['application/json-rpc'],
    ['application/jsonrequest'],
    ['Application/JSON'],
    ['application/json; charset=utf-8'],
    ['  application/json-rpc ;charset=UTF-8'],
    [['application/json']],
  ])('accepts %j', (contentType) => {
    expect(isJsonRpcMediaType(contentType)).toBe(true)
  })

  it.each([
    [undefined],
    [''],
    [[]],
    ['text/plain'],
    ['text/plain; charset=utf-8'],
    ['application/x-www-form-urlencoded'],
    ['multipart/form-data; boundary=x'],
    ['application/jsonx'],
    ['application/vnd.api+json'],
    [['application/json', 'text/plain']],
  ])('rejects %j', (contentType) => {
    expect(isJsonRpcMediaType(contentType)).toBe(false)
  })
})

describe('parseJsonRpcRequest', () => {
  it.each([
    [
      { jsonrpc: '2.0', method: 'subtract', params: [42, 23], id: 1 },
      { valid: true, method: 'subtract', params: [42, 23], id: 1, notification: false },
    ],
    [
      { jsonrpc: '2.0', method: 'subtract', params: { subtrahend: 23 }, id: 'abc' },
      { valid: true, method: 'subtract', params: { subtrahend: 23 }, id: 'abc', notification: false },
    ],
    [
      { jsonrpc: '2.0', method: 'update', params: [1, 2] },
      { valid: true, method: 'update', params: [1, 2], id: undefined, notification: true },
    ],
    [
      { jsonrpc: '2.0', method: 'ping', id: null },
      { valid: true, method: 'ping', params: undefined, id: null, notification: false },
    ],
    [
      { jsonrpc: '2.0', method: 'ping', params: null, id: 1.5 },
      { valid: true, method: 'ping', params: undefined, id: 1.5, notification: false },
    ],
    [
      { jsonrpc: '2.0', method: '', id: 0 },
      { valid: true, method: '', params: undefined, id: 0, notification: false },
    ],
    [
      { jsonrpc: '2.0', method: 'rpc.discover', id: '' },
      { valid: true, method: 'rpc.discover', params: undefined, id: '', notification: false },
    ],
    [
      { jsonrpc: '2.0', method: 'ping', params: undefined, id: undefined },
      { valid: true, method: 'ping', params: undefined, id: undefined, notification: true },
    ],
    [
      { jsonrpc: '2.0', method: 'ping', id: 1, extra: true },
      { valid: true, method: 'ping', params: undefined, id: 1, notification: false },
    ],
  ])('accepts %j', (item, expected) => {
    expect(parseJsonRpcRequest(item)).toEqual(expected)
  })

  it('accepts null-prototype request objects and params', () => {
    const params = Object.assign(Object.create(null), { a: 1 })
    const item = Object.assign(Object.create(null), { jsonrpc: '2.0', method: 'ping', params, id: 1 })

    expect(parseJsonRpcRequest(item)).toEqual({ valid: true, method: 'ping', params, id: 1, notification: false })
  })

  it.each([
    // not an object
    [1, null],
    ['x', null],
    [null, null],
    [true, null],
    [[], null],
    [[{ jsonrpc: '2.0', method: 'ping', id: 1 }], null],
    // invalid members, the id is echoed when valid
    [{}, null],
    [{ foo: 'boo' }, null],
    [{ jsonrpc: '2.0', method: 1, params: 'bar' }, null],
    [{ jsonrpc: '2.0', method: 1, id: 1 }, 1],
    [{ jsonrpc: '1.0', method: 'ping', id: 'abc' }, 'abc'],
    [{ method: 'ping', id: 2 }, 2],
    [{ jsonrpc: 2, method: 'ping', id: 3 }, 3],
    [{ jsonrpc: '2.0', id: 4 }, 4],
    [{ jsonrpc: '2.0', method: 'ping', params: 'x', id: 5 }, 5],
    [{ jsonrpc: '2.0', method: 'ping', params: 1, id: null }, null],
    [{ jsonrpc: '2.0', method: 'ping', params: true, id: 6 }, 6],
    [{ jsonrpc: '2.0', method: 'ping', params: new Date(), id: 7 }, 7],
    // invalid id types
    [{ jsonrpc: '2.0', method: 'ping', id: {} }, null],
    [{ jsonrpc: '2.0', method: 'ping', id: [1] }, null],
    [{ jsonrpc: '2.0', method: 'ping', id: true }, null],
    [{ jsonrpc: '2.0', method: 'ping', id: Number.POSITIVE_INFINITY }, null],
    [{ jsonrpc: '2.0', method: 'ping', id: Number.NaN }, null],
    [{ jsonrpc: '2.0', method: 1, id: {} }, null],
  ])('rejects %j (id: %j)', (item, id) => {
    expect(parseJsonRpcRequest(item)).toEqual({ valid: false, id })
  })

  it('rejects class instances', () => {
    const item = new (class {
      jsonrpc = '2.0'
      method = 'ping'
      id = 1
    })()

    expect(parseJsonRpcRequest(item)).toEqual({ valid: false, id: null })
  })

  it('ignores an own __proto__ member', () => {
    const item = JSON.parse('{"jsonrpc":"2.0","method":"ping","__proto__":{"id":1,"params":[1]}}')

    expect(Object.hasOwn(item, '__proto__')).toBe(true)
    expect(parseJsonRpcRequest(item)).toEqual({ valid: true, method: 'ping', params: undefined, id: undefined, notification: true })
  })

  it('ignores inherited members', () => {
    const prototype = Object.prototype as Record<string, unknown>

    prototype.id = 1
    prototype.params = 'invalid'

    try {
      expect(parseJsonRpcRequest({ jsonrpc: '2.0', method: 'ping' })).toEqual({
        valid: true,
        method: 'ping',
        params: undefined,
        id: undefined,
        notification: true,
      })

      prototype.jsonrpc = '2.0'
      prototype.method = 'ping'

      expect(parseJsonRpcRequest({ id: 2 })).toEqual({ valid: false, id: 2 })
    }
    finally {
      delete prototype.id
      delete prototype.params
      delete prototype.jsonrpc
      delete prototype.method
    }
  })
})

describe('encodeJsonRpcError', () => {
  const serializer = new OpenAPIJsonSerializer()

  it('encodes the code, message, and oRPC error data', () => {
    const error = new ORPCError('NOT_FOUND', { message: 'Planet not found', data: { id: 1n, at: new Date('2020-01-01T00:00:00.000Z') } })

    expect(encodeJsonRpcError(error, { serializer })).toEqual({
      code: -32004,
      message: 'Planet not found',
      data: { code: 'NOT_FOUND', defined: false, data: { id: '1', at: '2020-01-01T00:00:00.000Z' } },
    })
  })

  it('omits undefined error data', () => {
    const encoded = encodeJsonRpcError(new ORPCError('BAD_REQUEST'), { serializer })

    expect(encoded).toEqual({ code: -32602, message: 'Bad Request', data: { code: 'BAD_REQUEST', defined: false } })
    expect(Object.keys(encoded.data as object)).toEqual(['code', 'defined'])

    const keepUndefined = new OpenAPIJsonSerializer({ omitUndefinedProperties: false })
    expect(Object.keys(encodeJsonRpcError(new ORPCError('BAD_REQUEST'), { serializer: keepUndefined }).data as object))
      .toEqual(['code', 'defined'])
  })

  it('keeps null error data', () => {
    expect(encodeJsonRpcError(new ORPCError('BAD_REQUEST', { data: null }), { serializer }).data)
      .toEqual({ code: 'BAD_REQUEST', defined: false, data: null })
  })

  it('keeps the defined flag', () => {
    const error = new ORPCError('OUT_OF_STOCK', { data: { remaining: 0 } })
    Object.defineProperty(error, 'defined', { value: true })

    expect(encodeJsonRpcError(error, { serializer, errorCodeMap: { OUT_OF_STOCK: 1001 } })).toEqual({
      code: 1001,
      message: 'Out Of Stock',
      data: { code: 'OUT_OF_STOCK', defined: true, data: { remaining: 0 } },
    })
  })

  it('maps codes missing from the error code map to -32000', () => {
    expect(encodeJsonRpcError(new ORPCError('OUT_OF_STOCK'), { serializer }).code).toBe(-32000)
    expect(encodeJsonRpcError(new ORPCError('BAD_REQUEST'), { serializer, errorCodeMap: {} }).code).toBe(-32000)
  })

  it('prefers the custom encoder unless it returns null or undefined', () => {
    const error = new ORPCError('BAD_REQUEST')
    const customErrorEncoder = vi.fn()

    customErrorEncoder.mockReturnValueOnce({ code: 1, message: 'custom' })
    expect(encodeJsonRpcError(error, { serializer, customErrorEncoder })).toEqual({ code: 1, message: 'custom' })
    expect(customErrorEncoder).toHaveBeenCalledWith(error)

    customErrorEncoder.mockReturnValueOnce(null)
    expect(encodeJsonRpcError(error, { serializer, customErrorEncoder }).code).toBe(-32602)

    customErrorEncoder.mockReturnValueOnce(undefined)
    expect(encodeJsonRpcError(error, { serializer, customErrorEncoder }).code).toBe(-32602)
  })

  it('uses the given serializer', () => {
    const custom = new OpenAPIJsonSerializer({
      handlers: { date: { condition: v => v instanceof Date, serialize: (v: Date) => v.getTime(), isTerminal: true } },
    })

    expect(encodeJsonRpcError(new ORPCError('BAD_REQUEST', { data: new Date(0) }), { serializer: custom }).data)
      .toEqual({ code: 'BAD_REQUEST', defined: false, data: 0 })
  })
})

describe('createJsonRpcProtocolErrorResponse', () => {
  it.each([
    [-32700, 'Parse error'],
    [-32600, 'Invalid Request'],
    [-32601, 'Method not found'],
    [-32602, 'Invalid params'],
    [-32603, 'Internal error'],
  ] as const)('uses the canonical message for %d without data', (code, message) => {
    const response = createJsonRpcProtocolErrorResponse(1, code)

    expect(response).toEqual({ jsonrpc: '2.0', id: 1, error: { code, message } })
    expect(Object.keys(response.error)).toEqual(['code', 'message'])
  })

  it('keeps the id', () => {
    expect(createJsonRpcProtocolErrorResponse(null, -32700).id).toBe(null)
    expect(createJsonRpcProtocolErrorResponse('abc', -32601).id).toBe('abc')
  })
})

describe('omitBodyHeaders', () => {
  it('drops body headers and undefined values', () => {
    expect(omitBodyHeaders({
      'content-type': 'application/json',
      'content-length': '10',
      'content-disposition': 'inline',
      'standard-server': 'json',
      'set-cookie': ['a=1', 'b=2'],
      'retry-after': '5',
      'x-undefined': undefined,
    })).toEqual({
      'set-cookie': ['a=1', 'b=2'],
      'retry-after': '5',
    })
  })

  it('returns a copy', () => {
    const headers = { 'x-a': '1' }
    const result = omitBodyHeaders(headers)

    expect(result).toEqual(headers)
    expect(result).not.toBe(headers)
  })
})

describe('liftSubresponseHeaders', () => {
  it('returns no headers without subresponses', () => {
    expect(liftSubresponseHeaders([])).toEqual({})
  })

  it('keeps the headers of a single subresponse, minus body headers', () => {
    expect(liftSubresponseHeaders([{ 'x-a': '1', 'content-type': 'application/json', 'x-undefined': undefined }])).toEqual({ 'x-a': '1' })
  })

  it('keeps only the headers every subresponse shares with the same value', () => {
    expect(liftSubresponseHeaders([
      { 'x-shared': '1', 'x-different': 'a', 'x-partial': '1', 'x-list': ['a', 'b'] },
      { 'x-shared': '1', 'x-different': 'b', 'x-list': 'a, b' },
      { 'x-shared': '1', 'x-different': 'a', 'x-list': ['a', 'b'] },
    ])).toEqual({ 'x-shared': '1', 'x-list': ['a', 'b'] })
  })

  it('unions distinct cookies', () => {
    expect(liftSubresponseHeaders([
      { 'set-cookie': ['session=abc', 'theme=dark'] },
      {},
      { 'set-cookie': 'session=abc' },
      { 'set-cookie': ['token=xyz'] },
    ])).toEqual({ 'set-cookie': ['session=abc', 'theme=dark', 'token=xyz'] })
  })

  it('merges vary fields case-insensitively', () => {
    expect(liftSubresponseHeaders([
      { vary: 'Origin, Accept-Language' },
      { vary: ['origin', 'Cookie'] },
      {},
    ])).toEqual({ vary: 'Origin, Accept-Language, Cookie' })
  })

  it('lets a vary * win', () => {
    expect(liftSubresponseHeaders([
      { vary: 'Origin' },
      { vary: '*' },
    ])).toEqual({ vary: '*' })
  })
})

describe('isPartialResponseBody', () => {
  it.each([
    [{ result: null }],
    [{ result: 0 }],
    [{ result: { a: 1 } }],
    [{ error: { code: -32602, message: 'Invalid params' } }],
    [{ error: { code: 1, message: 'x', data: 1 }, extra: true }],
    [Object.assign(Object.create(null), { result: 'null prototype' })],
  ])('accepts %j', (body) => {
    expect(isPartialResponseBody(body)).toBe(true)
  })

  it.each([
    [undefined],
    [null],
    ['result'],
    [[{ result: 1 }]],
    [{}],
    [{ result: undefined }],
    [{ result: 1, error: { code: 1, message: 'x' } }],
    [{ result: undefined, error: { code: 1, message: 'x' } }],
    [{ error: { code: 1.5, message: 'x' } }],
    [{ error: { code: 1 } }],
    [{ error: 'x' }],
    [{ jsonrpc: '2.0', id: 1 }],
    [Object.create({ result: 1 })],
    [new Blob(['x'])],
  ])('rejects %j', (body) => {
    expect(isPartialResponseBody(body)).toBe(false)
  })
})

describe('cancelQuietly', () => {
  it('cancels streams', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream({ cancel })

    await cancelQuietly(stream)

    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('returns async iterators', async () => {
    let finished = false

    const iterator = (async function* () {
      try {
        yield 1
      }
      finally {
        finished = true
      }
    })()

    await iterator.next()
    await cancelQuietly(iterator)

    expect(finished).toBe(true)
  })

  it('ignores cleanup failures', async () => {
    const stream = new ReadableStream({
      cancel() {
        throw new Error('cleanup failure')
      },
    })

    await expect(cancelQuietly(stream)).resolves.toBeUndefined()
  })

  it('ignores other bodies', async () => {
    await expect(cancelQuietly(undefined)).resolves.toBeUndefined()
    await expect(cancelQuietly({ result: 1 })).resolves.toBeUndefined()
  })
})
