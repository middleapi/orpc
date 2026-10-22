import { COMMON_JSON_RPC_ERROR_CODE_MAP } from './constants'
import {
  fromJsonRpcErrorCode,
  isJsonRpcErrorObject,
  isJsonRpcResponse,
  isOpenRPCErrorData,
  toJsonRpcErrorCode,
} from './json-rpc'

describe('isJsonRpcErrorObject', () => {
  it.each([
    [{ code: -32600, message: 'Invalid Request' }],
    [{ code: 1, message: '', data: { any: 'thing' } }],
    [Object.assign(Object.create(null), { code: 0, message: 'null prototype' })],
  ])('accepts %j', (value) => {
    expect(isJsonRpcErrorObject(value)).toBe(true)
  })

  it.each([
    [undefined],
    [null],
    ['error'],
    [[{ code: 1, message: 'x' }]],
    [{ message: 'missing code' }],
    [{ code: 1 }],
    [{ code: 1.5, message: 'fractional code' }],
    [{ code: '1', message: 'string code' }],
    [{ code: Number.NaN, message: 'nan' }],
    [{ code: 1, message: 2 }],
    [Object.create({ code: 1, message: 'inherited' })],
    [new (class { code = 1; message = 'class instance' })()],
  ])('rejects %j', (value) => {
    expect(isJsonRpcErrorObject(value)).toBe(false)
  })
})

describe('isJsonRpcResponse', () => {
  it.each([
    [{ jsonrpc: '2.0', id: 1, result: 19 }],
    [{ jsonrpc: '2.0', id: 'abc', result: null }],
    [{ jsonrpc: '2.0', id: 1.5, result: [] }],
    [{ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }],
    [{ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'x', data: { code: 'X', defined: false } } }],
  ])('accepts %j', (value) => {
    expect(isJsonRpcResponse(value)).toBe(true)
  })

  it.each([
    ['both result and error', { jsonrpc: '2.0', id: 1, result: 1, error: { code: 1, message: 'x' } }],
    ['neither result nor error', { jsonrpc: '2.0', id: 1 }],
    ['an array (batch)', [{ jsonrpc: '2.0', id: 1, result: 1 }]],
    ['a missing jsonrpc', { id: 1, result: 1 }],
    ['a wrong jsonrpc', { jsonrpc: '1.0', id: 1, result: 1 }],
    ['a numeric jsonrpc', { jsonrpc: 2, id: 1, result: 1 }],
    ['a missing id', { jsonrpc: '2.0', result: 1 }],
    ['an object id', { jsonrpc: '2.0', id: {}, result: 1 }],
    ['a boolean id', { jsonrpc: '2.0', id: true, result: 1 }],
    ['an infinite id', { jsonrpc: '2.0', id: Number.POSITIVE_INFINITY, result: 1 }],
    ['a non-integer error code', { jsonrpc: '2.0', id: 1, error: { code: 1.5, message: 'x' } }],
    ['an error without message', { jsonrpc: '2.0', id: 1, error: { code: 1 } }],
    ['a non-object error', { jsonrpc: '2.0', id: 1, error: 'x' }],
    ['a primitive', 'x'],
    ['null', null],
    ['an inherited result', Object.assign(Object.create({ result: 1 }), { jsonrpc: '2.0', id: 1 })],
    ['an inherited id', Object.assign(Object.create({ id: 1 }), { jsonrpc: '2.0', result: 1 })],
    ['an inherited jsonrpc', Object.assign(Object.create({ jsonrpc: '2.0' }), { id: 1, result: 1 })],
  ])('rejects %s', (_, value) => {
    expect(isJsonRpcResponse(value)).toBe(false)
  })
})

describe('isOpenRPCErrorData', () => {
  it.each([
    [{ code: 'BAD_REQUEST', defined: false }],
    [{ code: 'OUT_OF_STOCK', defined: true, data: { remaining: 0 } }],
    [{ code: 'X', defined: true, data: undefined }],
  ])('accepts %j', (value) => {
    expect(isOpenRPCErrorData(value)).toBe(true)
  })

  it.each([
    [undefined],
    [null],
    ['BAD_REQUEST'],
    [{ code: 'BAD_REQUEST' }],
    [{ defined: true }],
    [{ code: 1, defined: true }],
    [{ code: 'X', defined: 'true' }],
    [{ code: 'X', defined: true, extra: 1 }],
    [{ code: 'X', defined: true, data: 1, message: 'x' }],
    [Object.create({ code: 'X', defined: true })],
  ])('rejects %j', (value) => {
    expect(isOpenRPCErrorData(value)).toBe(false)
  })
})

describe('toJsonRpcErrorCode', () => {
  it('maps codes with the common map by default', () => {
    expect(toJsonRpcErrorCode('BAD_REQUEST')).toBe(-32602)
    expect(toJsonRpcErrorCode('UNAUTHORIZED')).toBe(-32001)
    expect(toJsonRpcErrorCode('INTERNAL_SERVER_ERROR')).toBe(-32603)
  })

  it('falls back to -32000 for unknown codes', () => {
    expect(toJsonRpcErrorCode('OUT_OF_STOCK')).toBe(-32000)
  })

  it('uses only own properties of the map', () => {
    expect(toJsonRpcErrorCode('toString')).toBe(-32000)
    expect(toJsonRpcErrorCode('__proto__')).toBe(-32000)
    expect(toJsonRpcErrorCode('constructor', { BAD_REQUEST: 1 })).toBe(-32000)
  })

  it('replaces (does not extend) the default map with a custom map', () => {
    const errorCodeMap = { OUT_OF_STOCK: 1001 }

    expect(toJsonRpcErrorCode('OUT_OF_STOCK', errorCodeMap)).toBe(1001)
    expect(toJsonRpcErrorCode('BAD_REQUEST', errorCodeMap)).toBe(-32000)
    expect(toJsonRpcErrorCode('BAD_REQUEST', { ...COMMON_JSON_RPC_ERROR_CODE_MAP, ...errorCodeMap })).toBe(-32602)
  })
})

describe('fromJsonRpcErrorCode', () => {
  it('maps the protocol error codes', () => {
    expect(fromJsonRpcErrorCode(-32700)).toBe('BAD_REQUEST')
    expect(fromJsonRpcErrorCode(-32600)).toBe('BAD_REQUEST')
    expect(fromJsonRpcErrorCode(-32601)).toBe('NOT_FOUND')
    expect(fromJsonRpcErrorCode(-32602)).toBe('BAD_REQUEST')
    expect(fromJsonRpcErrorCode(-32603)).toBe('INTERNAL_SERVER_ERROR')
  })

  it('reverses the common map, preferring its first key', () => {
    expect(fromJsonRpcErrorCode(-32001)).toBe('UNAUTHORIZED')
    expect(fromJsonRpcErrorCode(-32004)).toBe('NOT_FOUND')
    expect(fromJsonRpcErrorCode(-32029)).toBe('TOO_MANY_REQUESTS')
    expect(fromJsonRpcErrorCode(-32099)).toBe('CLIENT_CLOSED_REQUEST')

    for (const [code, jsonRpcCode] of Object.entries(COMMON_JSON_RPC_ERROR_CODE_MAP)) {
      if (jsonRpcCode !== -32602 && jsonRpcCode !== -32603) {
        expect(fromJsonRpcErrorCode(jsonRpcCode)).toBe(code)
      }
    }
  })

  it('falls back to INTERNAL_SERVER_ERROR', () => {
    expect(fromJsonRpcErrorCode(-32000)).toBe('INTERNAL_SERVER_ERROR')
    expect(fromJsonRpcErrorCode(-32050)).toBe('INTERNAL_SERVER_ERROR')
    expect(fromJsonRpcErrorCode(3)).toBe('INTERNAL_SERVER_ERROR')
    expect(fromJsonRpcErrorCode(1001)).toBe('INTERNAL_SERVER_ERROR')
  })
})
