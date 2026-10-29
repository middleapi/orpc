it('exports createORPCClient, ORPCError, DynamicLink, RPCJsonSerializer, RPCSerializer, headers helpers', async () => {
  await expect(import('./index')).resolves.toEqual(expect.objectContaining({
    getRequestHeaders: expect.any(Function),
    getResponseHeaders: expect.any(Function),
    REQUEST_HEADERS_CONTEXT_SYMBOL: expect.any(Symbol),
    RESPONSE_HEADERS_CONTEXT_SYMBOL: expect.any(Symbol),
    createORPCClient: expect.any(Function),
    ORPCError: expect.any(Function),
    DynamicLink: expect.any(Function),
    RPCJsonSerializer: expect.any(Function),
    RPCSerializer: expect.any(Function),
  }))
})
