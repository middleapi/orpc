it('exports EvlogHandlerPlugin', async () => {
  expect(Object.keys(await import('./index.ts'))).toContain('EvlogHandlerPlugin')
})
