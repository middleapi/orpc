it('exports createRatelimitMiddleware', async () => {
  expect(Object.keys(await import('./index'))).toContain('createRatelimitMiddleware')
})
