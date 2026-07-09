it('exports RPCHandler, BodyCompressionHandlerPlugin', async () => {
  await expect(import('.')).resolves.toMatchObject({
    RPCHandler: expect.any(Function),
    BodyCompressionHandlerPlugin: expect.any(Function),
  })
})
