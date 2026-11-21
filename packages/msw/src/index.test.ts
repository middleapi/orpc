it('exports createHTTPUtils', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    createHTTPUtils: expect.any(Function),
  })
})

it('does not export generic names or utils classes', async () => {
  const exports = await import('./index')

  expect(exports).not.toHaveProperty('HTTPProcedureUtils')
})
