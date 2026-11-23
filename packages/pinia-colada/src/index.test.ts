it('exports createPiniaColadaUtils, PINIA_COLADA_OPERATION_CONTEXT_SYMBOL, StreamQuerySSRUtilsPlugin', async () => {
  const exports = await import('./index')

  expect(exports).toMatchObject({
    createPiniaColadaUtils: expect.any(Function),
    createRouterUtils: expect.any(Function),
    PINIA_COLADA_OPERATION_CONTEXT_SYMBOL: expect.any(Symbol),
    OPERATION_CONTEXT_SYMBOL: expect.any(Symbol),
    StreamQuerySSRUtilsPlugin: expect.any(Function),
  })
  expect(exports).not.toHaveProperty('ProcedureUtils')
  expect(exports).not.toHaveProperty('SharedUtils')
})
