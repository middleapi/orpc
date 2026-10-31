it('exports StandardOpenRPCHandler, OpenRPCLinkCodec, getJsonRpcCall', async () => {
  await expect(import('.')).resolves.toMatchObject({
    StandardOpenRPCHandler: expect.any(Function),
    OpenRPCLinkCodec: expect.any(Function),
    getJsonRpcCall: expect.any(Function),
  })
})
