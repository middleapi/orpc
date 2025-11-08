it('exports LoggingHandlerPlugin', async () => {
  expect(Object.keys(await import('./index'))).toContain('LoggingHandlerPlugin')
})
