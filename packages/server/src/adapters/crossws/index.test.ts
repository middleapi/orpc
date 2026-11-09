it('exports RPCHandler', async () => {
  await expect(import('./index')).resolves.toHaveProperty('experimental_RPCHandler')
})
