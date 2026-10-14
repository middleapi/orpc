it('exports StandardLink, RPCLinkCodec, isSuccessResponseStatus', async () => {
  await expect(import('.')).resolves.toMatchObject({
    StandardLink: expect.any(Function),
    RPCLinkCodec: expect.any(Function),
    isSuccessResponseStatus: expect.any(Function),
  })
})
