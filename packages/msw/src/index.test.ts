it('exports createHTTPUtils', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    createHTTPUtils: expect.any(Function),
  })
})

it('does not export internal helpers', async () => {
  const mod = await import('./index')

  expect(mod).not.toHaveProperty('HTTPProcedureUtils')
})
