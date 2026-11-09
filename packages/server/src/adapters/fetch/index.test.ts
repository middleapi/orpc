it('exports RPCHandler', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    RPCHandler: expect.any(Function),
  })
})
