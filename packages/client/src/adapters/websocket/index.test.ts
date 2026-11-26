it('exports RPCLink', async () => {
  await expect(import('./index')).resolves.toHaveProperty('RPCLink')
})
