it('exports OpenRPCDiscoveryHandlerPlugin', async () => {
  expect(Object.keys(await import('.'))).toEqual(['OpenRPCDiscoveryHandlerPlugin'])
  await expect(import('.')).resolves.toMatchObject({
    OpenRPCDiscoveryHandlerPlugin: expect.any(Function),
  })
})
