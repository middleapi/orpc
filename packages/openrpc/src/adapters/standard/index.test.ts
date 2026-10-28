it('exports StandardOpenRPCHandler, OpenRPCHandlerCodec, OpenRPCEnvelopeHandlerPlugin, OpenRPCLinkCodec, getJsonRpcCall', async () => {
  await expect(import('.')).resolves.toMatchObject({
    StandardOpenRPCHandler: expect.any(Function),
    OpenRPCHandlerCodec: expect.any(Function),
    OpenRPCEnvelopeHandlerPlugin: expect.any(Function),
    OpenRPCLinkCodec: expect.any(Function),
    getJsonRpcCall: expect.any(Function),
  })
})
