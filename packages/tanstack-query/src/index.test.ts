it('exports createTanstackQueryUtils, TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    createTanstackQueryUtils: expect.any(Function),
    TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL: expect.any(Symbol),
  })
})

it('does not export internal helpers', async () => {
  const mod = await import('./index')

  expect(mod).not.toHaveProperty('CompositeRouterUtilsPlugin')
  expect(mod).not.toHaveProperty('generateOperationKey')
  expect(mod).not.toHaveProperty('isProcedureUtilsOptions')
  expect(mod).not.toHaveProperty('ProcedureUtils')
  expect(mod).not.toHaveProperty('serializableStreamedQuery')
  expect(mod).not.toHaveProperty('SharedUtils')
})
