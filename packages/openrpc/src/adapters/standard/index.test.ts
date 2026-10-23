it('exports OpenRPCHandlerCodec, OpenRPCEnvelopeHandlerPlugin, OpenRPCLinkCodec, getJsonRpcCall', async () => {
  await expect(import('.')).resolves.toMatchObject({
    OpenRPCHandlerCodec: expect.any(Function),
    OpenRPCEnvelopeHandlerPlugin: expect.any(Function),
    OpenRPCLinkCodec: expect.any(Function),
    getJsonRpcCall: expect.any(Function),
  })
})
