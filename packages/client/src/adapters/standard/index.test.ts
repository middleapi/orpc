it('exports StandardLink, RPCLinkCodec', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    StandardLink: expect.any(Function),
    RPCLinkCodec: expect.any(Function),
  })
})
