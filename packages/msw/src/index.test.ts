it('exports createHTTPUtils', async () => {
  const exports = await import('./index')

  expect(exports).toMatchObject({
    createHTTPUtils: expect.any(Function),
    HTTPProcedureUtils: expect.any(Function),
  })
})
