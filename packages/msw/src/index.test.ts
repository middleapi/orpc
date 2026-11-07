it('exports createHTTPUtils', async () => {
  await expect(import('./index.ts')).resolves.toMatchObject({
    createHTTPUtils: expect.any(Function),
  })
})
