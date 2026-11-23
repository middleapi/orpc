it('exports createSWRUtils, SWR_OPERATION_CONTEXT_SYMBOL', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    createSWRUtils: expect.any(Function),
    SWR_OPERATION_CONTEXT_SYMBOL: expect.any(Symbol),
  })
})

it('exports the generic names, but no utils classes', async () => {
  const exports = await import('./index')

  expect(exports).toHaveProperty('createRouterUtils')
  expect(exports).toHaveProperty('OPERATION_CONTEXT_SYMBOL')
  expect(exports).not.toHaveProperty('ProcedureUtils')
  expect(exports).not.toHaveProperty('SharedUtils')
})
