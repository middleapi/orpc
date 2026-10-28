it('exports openrpc meta, OpenRPCGenerator, JSON-RPC helpers and constants', async () => {
  await expect(import('.')).resolves.toMatchObject({
    openrpc: expect.any(Function),
    getOpenRPCMeta: expect.any(Function),
    OpenRPCGenerator: expect.any(Function),
    OpenRPCGeneratorError: expect.any(Function),
    isJsonRpcResponse: expect.any(Function),
    encodeJsonRpcError: expect.any(Function),
    fromJsonRpcErrorCode: expect.any(Function),
    COMMON_JSON_RPC_ERROR_CODE_MAP: expect.any(Object),
  })
})
