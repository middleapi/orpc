it('exports OpenRPCDiscoveryHandlerPlugin', async () => {
  await expect(import('.')).resolves.toMatchObject({
    OpenRPCDiscoveryHandlerPlugin: expect.any(Function),
  })
})
