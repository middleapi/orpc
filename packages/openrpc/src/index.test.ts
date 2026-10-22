import { COMMON_ERROR_STATUS_MAP } from '@orpc/client'

it('exports constants, JSON-RPC helpers, openrpc meta, OpenRPCGenerator, and COMMON_ERROR_STATUS_MAP', async () => {
  await expect(import('.')).resolves.toMatchObject({
    JSON_RPC_VERSION: '2.0',
    JSON_RPC_ERROR_CODES: expect.any(Object),
    DEFAULT_JSON_RPC_ERROR_CODE: expect.any(Number),
    COMMON_JSON_RPC_ERROR_CODE_MAP: expect.any(Object),
    DEFAULT_JSON_RPC_MAX_BATCH_SIZE: expect.any(Number),
    DEFAULT_OPENRPC_VERSION: expect.any(String),
    isJsonRpcErrorObject: expect.any(Function),
    isJsonRpcResponse: expect.any(Function),
    isOpenRPCErrorData: expect.any(Function),
    toJsonRpcErrorCode: expect.any(Function),
    fromJsonRpcErrorCode: expect.any(Function),
    openrpc: expect.any(Function),
    getOpenRPCMeta: expect.any(Function),
    OpenRPCGenerator: expect.any(Function),
    OpenRPCGeneratorError: expect.any(Function),
    COMMON_ERROR_STATUS_MAP,
  })
})

it('does not export internal helpers', async () => {
  expect(Object.keys(await import('.')).sort()).toEqual([
    'COMMON_ERROR_STATUS_MAP',
    'COMMON_JSON_RPC_ERROR_CODE_MAP',
    'DEFAULT_JSON_RPC_ERROR_CODE',
    'DEFAULT_JSON_RPC_MAX_BATCH_SIZE',
    'DEFAULT_OPENRPC_VERSION',
    'JSON_RPC_ERROR_CODES',
    'JSON_RPC_VERSION',
    'OpenRPCGenerator',
    'OpenRPCGeneratorError',
    'fromJsonRpcErrorCode',
    'getOpenRPCMeta',
    'isJsonRpcErrorObject',
    'isJsonRpcResponse',
    'isOpenRPCErrorData',
    'openrpc',
    'toJsonRpcErrorCode',
  ])
})
