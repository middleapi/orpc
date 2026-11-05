it('exports RPCLink', async () => {
  await expect(import('./index.ts')).resolves.toHaveProperty('RPCLink')
})
