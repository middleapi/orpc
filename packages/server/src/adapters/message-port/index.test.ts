it('exports RPCHandler', async () => {
  await expect(import('./index')).resolves.toHaveProperty('RPCHandler')
})
