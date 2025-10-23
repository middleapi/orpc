it('exports OpenAPIHandler', async () => {
  expect(Object.keys(await import('./index'))).toContain('OpenAPIHandler')
})
