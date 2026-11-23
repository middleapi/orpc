it('exports createSWRUtils, SWR_OPERATION_CONTEXT_SYMBOL', async () => {
  const exports = await import('./index')

  expect(exports).toMatchObject({
    createSWRUtils: expect.any(Function),
    createRouterUtils: expect.any(Function),
    SWR_OPERATION_CONTEXT_SYMBOL: expect.any(Symbol),
    OPERATION_CONTEXT_SYMBOL: expect.any(Symbol),
  })
  expect(exports).not.toHaveProperty('ProcedureUtils')
  expect(exports).not.toHaveProperty('SharedUtils')
})
