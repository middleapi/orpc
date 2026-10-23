it('exports createSWRUtils, SWR_OPERATION_CONTEXT_SYMBOL', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    createSWRUtils: expect.any(Function),
    createRouterUtils: expect.any(Function),
    SWR_OPERATION_CONTEXT_SYMBOL: expect.any(Symbol),
  })
})

it('does not export internal helpers', async () => {
  const mod = await import('./index')

  expect(mod).not.toHaveProperty('generateOperationKey')
  expect(mod).not.toHaveProperty('isSubsetOf')
  expect(mod).not.toHaveProperty('ProcedureUtils')
  expect(mod).not.toHaveProperty('SharedUtils')
})
