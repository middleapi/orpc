import { COMMON_ERROR_STATUS_MAP } from '@orpc/client'
import { COMMON_JSON_RPC_ERROR_CODE_MAP } from './constants'

it('exports', async () => {
  await expect(import('./constants')).resolves.toMatchObject({
    JSON_RPC_VERSION: '2.0',
    JSON_RPC_ERROR_CODES: expect.any(Object),
    COMMON_JSON_RPC_ERROR_CODE_MAP: expect.any(Object),
    DEFAULT_JSON_RPC_ERROR_CODE: expect.any(Number),
    DEFAULT_JSON_RPC_MAX_BATCH_SIZE: expect.any(Number),
  })
})

it('maps every common error code, BAD_REQUEST to "Invalid params", other 4xx like tRPC and 5xx to "Internal error"', () => {
  expect(Object.keys(COMMON_JSON_RPC_ERROR_CODE_MAP)).toEqual(Object.keys(COMMON_ERROR_STATUS_MAP))

  for (const [code, status] of Object.entries(COMMON_ERROR_STATUS_MAP)) {
    const expected = code === 'BAD_REQUEST' ? -32602 : status >= 500 ? -32603 : -32000 - (status - 400)

    expect(COMMON_JSON_RPC_ERROR_CODE_MAP[code as keyof typeof COMMON_ERROR_STATUS_MAP]).toBe(expected)
  }
})
