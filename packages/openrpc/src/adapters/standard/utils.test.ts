import type { StandardLazyRequest } from '@standard-server/core'
import { getJsonRpcCall, isJsonRpcMediaType, JSON_RPC_CALL_SYMBOL } from './utils'

describe('getJsonRpcCall', () => {
  const request: StandardLazyRequest = { method: 'POST', url: '/rpc', headers: {}, resolveBody: vi.fn() }
  const call = { method: 'planet.find', id: 1 }

  it('returns the call of a sub-request marked by the envelope', () => {
    expect(getJsonRpcCall({ ...request, [JSON_RPC_CALL_SYMBOL]: call } as StandardLazyRequest)).toBe(call)
  })

  it('returns undefined for other requests', () => {
    expect(getJsonRpcCall(request)).toBeUndefined()
  })

  it('reads calls marked by another copy of the package', () => {
    expect(getJsonRpcCall({ ...request, [Symbol.for('ORPC_JSON_RPC_CALL')]: call } as StandardLazyRequest)).toBe(call)
  })
})

describe('isJsonRpcMediaType', () => {
  it.each([
    ['application/json', true],
    ['application/json-rpc', true],
    ['application/jsonrequest', true],
    ['Application/JSON; charset=utf-8', true],
    [['application/json'], true],
    [['application/json', 'text/plain'], false],
    ['text/plain', false],
    [undefined, false],
  ])('isJsonRpcMediaType(%j) is %s', (contentType, expected) => {
    expect(isJsonRpcMediaType(contentType)).toBe(expected)
  })
})
