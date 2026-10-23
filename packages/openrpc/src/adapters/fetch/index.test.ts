it('exports OpenRPCHandler and OpenRPCLink', async () => {
  await expect(import('.')).resolves.toMatchObject({
    OpenRPCHandler: expect.any(Function),
    OpenRPCLink: expect.any(Function),
  })
})
