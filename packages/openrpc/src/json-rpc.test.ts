import { createORPCErrorFromJson, ORPCError } from '@orpc/client'
import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { encodeJsonRpcError, fromJsonRpcErrorCode, hasJsonRpcResultOrError, isJsonRpcErrorObject, isJsonRpcId, isJsonRpcResponse } from './json-rpc'

describe('isJsonRpcId', () => {
  it.each([
    [null, true],
    ['abc', true],
    [1, true],
    [1.5, true],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
    [undefined, false],
    [true, false],
    [{}, false],
  ])('isJsonRpcId(%j) is %s', (value, expected) => {
    expect(isJsonRpcId(value)).toBe(expected)
  })
})

describe('isJsonRpcErrorObject', () => {
  it.each([
    [{ code: -32600, message: 'Invalid Request' }, true],
    [{ code: 1, message: '', data: { reason: 'x' } }, true],
    [{ code: 1.5, message: 'x' }, false],
    [{ code: '1', message: 'x' }, false],
    [{ code: 1 }, false],
    [[1, 'x'], false],
    [null, false],
  ])('isJsonRpcErrorObject(%j) is %s', (value, expected) => {
    expect(isJsonRpcErrorObject(value)).toBe(expected)
  })

  it('reads own properties only', () => {
    expect(isJsonRpcErrorObject(JSON.parse('{ "message": "x", "__proto__": { "code": 1 } }'))).toBe(false)
  })
})

describe('hasJsonRpcResultOrError', () => {
  it.each([
    [{ result: undefined }, true],
    [{ error: { code: 1, message: 'x' } }, true],
    [{}, false],
    [{ result: 1, error: { code: 1, message: 'x' } }, false],
    [{ error: { code: 1 } }, false],
    [[1], false],
  ])('hasJsonRpcResultOrError(%j) is %s', (value, expected) => {
    expect(hasJsonRpcResultOrError(value)).toBe(expected)
  })
})

describe('isJsonRpcResponse', () => {
  it.each([
    [{ jsonrpc: '2.0', id: 1, result: null }, true],
    [{ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, true],
    [{ jsonrpc: '2.0', id: 1 }, false],
    [{ jsonrpc: '2.0', result: 1 }, false],
    [{ jsonrpc: '1.0', id: 1, result: 1 }, false],
    [{ jsonrpc: '2.0', id: 1, result: 1, error: { code: 1, message: 'x' } }, false],
    [{ jsonrpc: '2.0', id: 1, error: { code: 1.5, message: 'x' } }, false],
    [{ jsonrpc: '2.0', id: {}, result: 1 }, false],
  ])('isJsonRpcResponse(%j) is %s', (value, expected) => {
    expect(isJsonRpcResponse(value)).toBe(expected)
  })

  it('reads own properties only', () => {
    expect(isJsonRpcResponse(JSON.parse('{ "jsonrpc": "2.0", "id": 1, "__proto__": { "result": 1 } }'))).toBe(false)
    expect(isJsonRpcResponse(Object.assign(Object.create({ jsonrpc: '2.0' }), { id: 1, result: 1 }))).toBe(false)
  })
})

describe('encodeJsonRpcError', () => {
  const serializer = new OpenAPIJsonSerializer()

  it('keeps the oRPC code, defined flag and serialized data in data', () => {
    const error = createORPCErrorFromJson({ code: 'NOT_FOUND', message: 'Planet not found', defined: true, data: { at: new Date(0) } })

    expect(encodeJsonRpcError(error, serializer)).toEqual({
      code: -32004,
      message: 'Planet not found',
      data: { code: 'NOT_FOUND', defined: true, data: { at: '1970-01-01T00:00:00.000Z' } },
    })
  })

  it('omits undefined oRPC data', () => {
    const { data } = encodeJsonRpcError(new ORPCError('BAD_GATEWAY'), serializer)

    expect(data).toEqual({ code: 'BAD_GATEWAY', defined: false })
    expect(data).not.toHaveProperty('data')
  })

  it('uses the given serializer', () => {
    const serializeJson = vi.fn(() => ({ json: 'custom', meta: [], maps: [], blobs: [] }))

    expect(encodeJsonRpcError(new ORPCError('NOT_FOUND', { data: 1 }), { serializeJson } as any).data).toBe('custom')
    expect(serializeJson).toHaveBeenCalledWith({ code: 'NOT_FOUND', defined: false, data: 1 })
  })

  it('falls back to -32000 for codes missing from the map', () => {
    expect(encodeJsonRpcError(new ORPCError('OUT_OF_STOCK'), serializer).code).toBe(-32000)
    expect(encodeJsonRpcError(new ORPCError('toString'), serializer).code).toBe(-32000)
    expect(encodeJsonRpcError(new ORPCError('__proto__'), serializer).code).toBe(-32000)
  })

  it('uses a custom error code map instead of the default one', () => {
    expect(encodeJsonRpcError(new ORPCError('OUT_OF_STOCK'), serializer, { OUT_OF_STOCK: 1001 }).code).toBe(1001)
    expect(encodeJsonRpcError(new ORPCError('NOT_FOUND'), serializer, { OUT_OF_STOCK: 1001 }).code).toBe(-32000)
  })
})

describe('fromJsonRpcErrorCode', () => {
  it.each([
    [-32700, 'BAD_REQUEST'],
    [-32600, 'BAD_REQUEST'],
    [-32601, 'NOT_FOUND'],
    [-32602, 'BAD_REQUEST'],
    [-32603, 'INTERNAL_SERVER_ERROR'],
    [-32004, 'NOT_FOUND'],
    [-32029, 'TOO_MANY_REQUESTS'],
    [-32000, 'INTERNAL_SERVER_ERROR'],
    [3, 'INTERNAL_SERVER_ERROR'],
  ])('fromJsonRpcErrorCode(%d) is %s', (code, expected) => {
    expect(fromJsonRpcErrorCode(code)).toBe(expected)
  })
})
