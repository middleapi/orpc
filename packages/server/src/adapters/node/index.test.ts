it('exports RPCHandler', async () => {
  await expect(import('./index.ts')).resolves.toMatchObject({
    RPCHandler: expect.any(Function),
  })
})
