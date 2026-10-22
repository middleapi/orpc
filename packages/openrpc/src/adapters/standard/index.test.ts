it('exports getJsonRpcCall, OpenRPCHandlerCodec, OpenRPCEnvelopeHandlerPlugin, OpenRPCLinkCodec', async () => {
  await expect(import('.')).resolves.toMatchObject({
    getJsonRpcCall: expect.any(Function),
    OpenRPCHandlerCodec: expect.any(Function),
    OpenRPCEnvelopeHandlerPlugin: expect.any(Function),
    OpenRPCLinkCodec: expect.any(Function),
  })
})

it('does not export internal helpers', async () => {
  expect(Object.keys(await import('.')).sort()).toEqual([
    'OpenRPCEnvelopeHandlerPlugin',
    'OpenRPCHandlerCodec',
    'OpenRPCLinkCodec',
    'getJsonRpcCall',
  ])
})
