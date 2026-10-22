import type { StandardLazyRequest } from '@standard-server/core'
import type { JsonRpcCall, JsonRpcCallRequest } from './call'
import { getJsonRpcCall, JSON_RPC_CALL_SYMBOL } from './call'

function createRequest(): StandardLazyRequest {
  return {
    method: 'POST',
    url: '/planet/find',
    headers: { 'content-type': 'application/json' },
    resolveBody: async () => ({ id: 1 }),
  }
}

describe('getJsonRpcCall', () => {
  const call: JsonRpcCall = { method: 'planet.find', id: 1, notification: false, batch: true }

  it('returns undefined for unmarked requests', () => {
    expect(getJsonRpcCall(createRequest())).toBeUndefined()
  })

  it('returns the call of a marked request', () => {
    const request: JsonRpcCallRequest = { ...createRequest(), [JSON_RPC_CALL_SYMBOL]: call }

    expect(getJsonRpcCall(request)).toBe(call)
  })

  it('keeps the marker through request spreads', () => {
    const request: JsonRpcCallRequest = { ...createRequest(), [JSON_RPC_CALL_SYMBOL]: call }
    const rewritten: StandardLazyRequest = { ...request, headers: { ...request.headers, 'x-extra': '1' } }

    expect(getJsonRpcCall(rewritten)).toBe(call)
  })

  it('cannot be forged with a same-named symbol', () => {
    const request = { ...createRequest(), [Symbol('ORPC_JSON_RPC_CALL')]: call }

    expect(getJsonRpcCall(request)).toBeUndefined()
  })

  it('is not exported from the entry point', async () => {
    const entry = await import('./index')

    expect(entry).toHaveProperty('getJsonRpcCall', getJsonRpcCall)
    expect(Object.values(entry)).not.toContain(JSON_RPC_CALL_SYMBOL)
    expect(entry).not.toHaveProperty('JSON_RPC_CALL_SYMBOL')
  })
})
