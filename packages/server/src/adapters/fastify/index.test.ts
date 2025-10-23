it('exports RPCHandler', async () => {
  expect(Object.keys(await import('./index'))).toContain('RPCHandler')
})
