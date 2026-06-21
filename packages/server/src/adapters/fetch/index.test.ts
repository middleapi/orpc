it('exports RPCHandler, BodyCompressionHandlerPlugin, BodyLimitHandlerPlugin', async () => {
  await expect(import('.')).resolves.toMatchObject({
    RPCHandler: expect.any(Function),
    BodyCompressionHandlerPlugin: expect.any(Function),
    BodyLimitHandlerPlugin: expect.any(Function),
  })
})
