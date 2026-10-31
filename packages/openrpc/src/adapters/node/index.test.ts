it('exports OpenRPCHandler', async () => {
  await expect(import('.')).resolves.toMatchObject({
    OpenRPCHandler: expect.any(Function),
  })
})
