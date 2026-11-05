it('exports RPCHandler', async () => {
  await expect(import('./index.ts')).resolves.toHaveProperty('experimental_RPCHandler')
})
