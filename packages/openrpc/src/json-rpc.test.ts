import { COMMON_ERROR_STATUS_MAP, ORPCError } from '@orpc/client'
import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { COMMON_JSON_RPC_ERROR_CODE_MAP } from './constants'
import { encodeJsonRpcError, fromJsonRpcErrorCode, isJsonRpcResponse } from './json-rpc'

it('maps every common error code, 4xx like tRPC and 5xx to "Internal error"', () => {
  expect(Object.keys(COMMON_JSON_RPC_ERROR_CODE_MAP)).toEqual(Object.keys(COMMON_ERROR_STATUS_MAP))

  for (const [code, status] of Object.entries(COMMON_ERROR_STATUS_MAP)) {
    const expected = code === 'BAD_REQUEST' ? -32602 : status >= 500 ? -32603 : -32000 - (status - 400)
    expect(COMMON_JSON_RPC_ERROR_CODE_MAP[code as keyof typeof COMMON_ERROR_STATUS_MAP]).toBe(expected)
  }
})

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

it('encodes ORPCErrors', () => {
  const serializer = new OpenAPIJsonSerializer()

  expect(encodeJsonRpcError(new ORPCError('NOT_FOUND', { data: { at: new Date(0) } }), serializer)).toEqual({
    code: -32004,
    message: 'Not Found',
    data: { code: 'NOT_FOUND', defined: false, data: { at: '1970-01-01T00:00:00.000Z' } },
  })
  expect(encodeJsonRpcError(new ORPCError('OUT_OF_STOCK'), serializer)).toMatchObject({ code: -32000 })
  expect(encodeJsonRpcError(new ORPCError('toString'), serializer)).toMatchObject({ code: -32000 })
  expect(encodeJsonRpcError(new ORPCError('OUT_OF_STOCK'), serializer, { OUT_OF_STOCK: 1001 })).toMatchObject({ code: 1001 })
})

it.each([
  [-32700, 'BAD_REQUEST'],
  [-32600, 'BAD_REQUEST'],
  [-32601, 'NOT_FOUND'],
  [-32602, 'BAD_REQUEST'],
  [-32603, 'INTERNAL_SERVER_ERROR'],
  [-32029, 'TOO_MANY_REQUESTS'],
  [-32000, 'INTERNAL_SERVER_ERROR'],
  [3, 'INTERNAL_SERVER_ERROR'],
])('fromJsonRpcErrorCode(%d) is %s', (code, expected) => {
  expect(fromJsonRpcErrorCode(code)).toBe(expected)
})
