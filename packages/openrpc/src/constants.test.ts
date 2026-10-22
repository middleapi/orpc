import { COMMON_ERROR_STATUS_MAP } from '@orpc/client'
import {
  COMMON_JSON_RPC_ERROR_CODE_MAP,
  DEFAULT_JSON_RPC_ERROR_CODE,
  DEFAULT_JSON_RPC_MAX_BATCH_SIZE,
  DEFAULT_OPENRPC_VERSION,
  JSON_RPC_ERROR_CODES,
  JSON_RPC_VERSION,
} from './constants'

describe('common JSON-RPC error code map', () => {
  it('covers exactly the common oRPC error codes', () => {
    expect(Object.keys(COMMON_JSON_RPC_ERROR_CODE_MAP).sort()).toEqual(Object.keys(COMMON_ERROR_STATUS_MAP).sort())
  })

  it('maps into the implementation-defined/reserved range with safe integers', () => {
    for (const code of Object.values(COMMON_JSON_RPC_ERROR_CODE_MAP)) {
      expect(Number.isSafeInteger(code)).toBe(true)
      expect(code).toBeGreaterThanOrEqual(-32768)
      expect(code).toBeLessThanOrEqual(-32000)
    }
  })

  it('derives codes from HTTP statuses', () => {
    for (const [code, status] of Object.entries(COMMON_ERROR_STATUS_MAP)) {
      const jsonRpcCode = COMMON_JSON_RPC_ERROR_CODE_MAP[code as keyof typeof COMMON_JSON_RPC_ERROR_CODE_MAP]

      if (code === 'BAD_REQUEST') {
        expect(jsonRpcCode).toBe(JSON_RPC_ERROR_CODES.INVALID_PARAMS)
      }
      else if (status >= 500) {
        expect(jsonRpcCode).toBe(JSON_RPC_ERROR_CODES.INTERNAL_ERROR)
      }
      else {
        expect(jsonRpcCode).toBe(-32000 - (status - 400))
      }
    }
  })

  it('keeps the envelope protocol codes for the envelope', () => {
    const values = Object.values(COMMON_JSON_RPC_ERROR_CODE_MAP) as number[]

    expect(values).not.toContain(JSON_RPC_ERROR_CODES.PARSE_ERROR)
    expect(values).not.toContain(JSON_RPC_ERROR_CODES.INVALID_REQUEST)
    expect(values).not.toContain(JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND)
    expect(values).not.toContain(DEFAULT_JSON_RPC_ERROR_CODE)
  })
})

it('defaults', () => {
  expect(JSON_RPC_VERSION).toBe('2.0')
  expect(JSON_RPC_ERROR_CODES).toEqual({
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603,
  })
  expect(DEFAULT_JSON_RPC_ERROR_CODE).toBe(-32000)
  expect(DEFAULT_JSON_RPC_MAX_BATCH_SIZE).toBe(100)
  expect(DEFAULT_OPENRPC_VERSION).toBe('1.3.2')
})
