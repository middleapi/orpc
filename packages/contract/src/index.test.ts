it('exports oc', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    oc: expect.any(Object),
  })
})

it('does not export internal helpers', async () => {
  const mod = await import('./index')

  expect(mod).not.toHaveProperty('augmentContractRouter')
  expect(mod).not.toHaveProperty('getAsyncIteratorObjectSchemaDetails')
  expect(mod).not.toHaveProperty('HIDDEN_META_PLUGINS_SYMBOL')
})
