it('exports os, ORPCError, createRouterClient, RPCJsonSerializer, RPCSerializer, headers helpers', async () => {
  await expect(import('.')).resolves.toMatchObject({
    getRequestHeaders: expect.any(Function),
    getResponseHeaders: expect.any(Function),
    REQUEST_HEADERS_CONTEXT_SYMBOL: expect.any(Symbol),
    RESPONSE_HEADERS_CONTEXT_SYMBOL: expect.any(Symbol),
    os: expect.any(Object),
    ORPCError: expect.any(Function),
    createRouterClient: expect.any(Function),
    RPCJsonSerializer: expect.any(Function),
    RPCSerializer: expect.any(Function),
  })
})
