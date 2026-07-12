it('exports EvlogHandlerPlugin, getLogger', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    EvlogHandlerPlugin: expect.any(Function),
    getLogger: expect.any(Function),
  })
})
