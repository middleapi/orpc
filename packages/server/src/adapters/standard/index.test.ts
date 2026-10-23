it('exports StandardHandler, resolveFriendlyStandardHandlerHandleOptions, RPCMatcher, RPCHandlerCodec', async () => {
  await expect(import('.')).resolves.toMatchObject({
    StandardHandler: expect.any(Function),
    resolveFriendlyStandardHandlerHandleOptions: expect.any(Function),
    RPCMatcher: expect.any(Function),
    RPCHandlerCodec: expect.any(Function),
  })
})
