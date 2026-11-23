it('exports createTanstackQueryUtils, TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL', async () => {
  const exports = await import('./index')

  expect(exports).toMatchObject({
    createTanstackQueryUtils: expect.any(Function),
    createRouterUtils: expect.any(Function),
    ProcedureUtils: expect.any(Function),
    SharedUtils: expect.any(Function),
    TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL: expect.any(Symbol),
    OPERATION_CONTEXT_SYMBOL: expect.any(Symbol),
  })
})
