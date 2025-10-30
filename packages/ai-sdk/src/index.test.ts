it('exports createTool', async () => {
  expect(Object.keys(await import('./index'))).toContain('createTool')
})
